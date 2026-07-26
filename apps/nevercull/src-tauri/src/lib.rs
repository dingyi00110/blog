use image::{DynamicImage, GrayImage};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Instant, UNIX_EPOCH};
use tauri::{Manager, State};
use walkdir::WalkDir;

const PREVIEW_MAX_EDGE: u32 = 512;
const DARK_PIXEL_LIMIT: u8 = 12;
const BRIGHT_PIXEL_LIMIT: u8 = 243;
const HASH_SIZE: u32 = 8;
const DUPLICATE_HASH_DISTANCE: u32 = 8;
const CSV_FILE_NAME: &str = "nevercull-results.csv";

struct AppState {
    connection: Mutex<Connection>,
    undoStack: Mutex<Vec<PhotoSnapshot>>,
    redoStack: Mutex<Vec<PhotoSnapshot>>,
}

#[derive(Clone, Serialize, Deserialize)]
struct PhotoRecord {
    id: i64,
    file_path: String,
    file_name: String,
    preview_url: String,
    rating: i64,
    rejected: bool,
    reviewed: bool,
    blur_score: f64,
    exposure_status: String,
    duplicate_group: Option<String>,
    duplicate_best: bool,
    reason: String,
    error: Option<String>,
}

#[derive(Clone)]
struct PhotoSnapshot {
    photoId: i64,
    beforeRating: i64,
    beforeRejected: bool,
    afterRating: i64,
    afterRejected: bool,
}

#[derive(Serialize)]
struct ScanResult {
    project_id: i64,
    scanned_count: usize,
    cached_count: usize,
    failed_count: usize,
    elapsed_ms: u128,
    photos: Vec<PhotoRecord>,
}

#[derive(Serialize)]
struct ExportPreview {
    create_count: usize,
    update_count: usize,
    skip_count: usize,
    paths: Vec<String>,
}

#[derive(Clone, Copy)]
struct Thresholds {
    darkRatio: f64,
    brightRatio: f64,
    blurVariance: f64,
}

#[derive(Clone)]
struct Analysis {
    blurScore: f64,
    exposureStatus: String,
    reason: String,
    hash: u64,
}

#[tauri::command]
fn scan_directory(directory_path: String, preset: String, state: State<AppState>) -> Result<ScanResult, String> {
    let startedAt = Instant::now();
    let rootPath = PathBuf::from(&directory_path);
    if !rootPath.is_dir() {
        return Err("所选路径不是可读取的目录".to_string());
    }
    let thresholds = thresholdsFor(&preset)?;
    let connection = state.connection.lock().map_err(lockError)?;
    let projectId = ensureProject(&connection, &directory_path)?;
    let mut cachedCount = 0;
    let mut failedCount = 0;

    for entry in WalkDir::new(&rootPath).follow_links(false).into_iter().filter_map(Result::ok) {
        let filePath = entry.path();
        if !entry.file_type().is_file() || !isSupported(filePath) {
            continue;
        }
        let metadata = match fs::metadata(filePath) {
            Ok(value) => value,
            Err(error) => {
                failedCount += 1;
                saveFailure(&connection, projectId, filePath, &error.to_string())?;
                continue;
            }
        };
        let modifiedAt = metadata.modified().ok().and_then(|value| value.duration_since(UNIX_EPOCH).ok())
            .map(|value| value.as_secs() as i64).unwrap_or_default();
        if isCached(&connection, projectId, filePath, metadata.len() as i64, modifiedAt)? {
            cachedCount += 1;
            continue;
        }
        match analyzeImage(filePath, thresholds) {
            Ok(analysis) => saveAnalysis(&connection, projectId, filePath, metadata.len() as i64, modifiedAt, analysis)?,
            Err(error) => {
                failedCount += 1;
                saveFailure(&connection, projectId, filePath, &error)?;
            }
        }
    }
    assignDuplicateGroups(&connection, projectId)?;
    let photos = loadPhotos(&connection, projectId)?;
    Ok(ScanResult { project_id: projectId, scanned_count: photos.len().saturating_sub(cachedCount), cached_count: cachedCount,
        failed_count: failedCount, elapsed_ms: startedAt.elapsed().as_millis(), photos })
}

#[tauri::command]
fn update_photo(photo_id: i64, rating: i64, rejected: bool, state: State<AppState>) -> Result<PhotoRecord, String> {
    if !(0..=5).contains(&rating) {
        return Err("星级必须在 0 到 5 之间".to_string());
    }
    let connection = state.connection.lock().map_err(lockError)?;
    let before = loadPhoto(&connection, photo_id)?;
    connection.execute("UPDATE photos SET rating=?1,rejected=?2,reviewed=1,reviewed_at=datetime('now') WHERE id=?3",
        params![rating, rejected, photo_id]).map_err(dbError)?;
    state.undoStack.lock().map_err(lockError)?.push(PhotoSnapshot { photoId: photo_id, beforeRating: before.rating,
        beforeRejected: before.rejected, afterRating: rating, afterRejected: rejected });
    state.redoStack.lock().map_err(lockError)?.clear();
    loadPhoto(&connection, photo_id)
}

#[tauri::command]
fn undo_action(state: State<AppState>) -> Result<Option<PhotoRecord>, String> {
    let action = state.undoStack.lock().map_err(lockError)?.pop();
    applyHistory(action, true, &state)
}

#[tauri::command]
fn redo_action(state: State<AppState>) -> Result<Option<PhotoRecord>, String> {
    let action = state.redoStack.lock().map_err(lockError)?.pop();
    applyHistory(action, false, &state)
}

#[tauri::command]
fn preview_export(project_id: i64, state: State<AppState>) -> Result<ExportPreview, String> {
    let connection = state.connection.lock().map_err(lockError)?;
    let photos = loadPhotos(&connection, project_id)?;
    let mut preview = ExportPreview { create_count: 0, update_count: 0, skip_count: 0, paths: Vec::new() };
    for photo in photos {
        let xmpPath = xmpPathFor(Path::new(&photo.file_path));
        if xmpPath.exists() { preview.update_count += 1; } else { preview.create_count += 1; }
        if preview.paths.len() < 20 { preview.paths.push(xmpPath.to_string_lossy().to_string()); }
    }
    Ok(preview)
}

#[tauri::command]
fn export_results(project_id: i64, conflict_mode: String, state: State<AppState>) -> Result<Vec<String>, String> {
    let connection = state.connection.lock().map_err(lockError)?;
    let photos = loadPhotos(&connection, project_id)?;
    let rootPath: String = connection.query_row("SELECT root_path FROM projects WHERE id=?1", [project_id], |row| row.get(0))
        .map_err(dbError)?;
    let mut failures = Vec::new();
    for photo in &photos {
        if let Err(error) = writeXmp(photo, &conflict_mode) { failures.push(format!("{}: {}", photo.file_name, error)); }
    }
    if let Err(error) = writeCsv(Path::new(&rootPath), &photos) { failures.push(format!("CSV: {error}")); }
    Ok(failures)
}

fn analyzeImage(path: &Path, thresholds: Thresholds) -> Result<Analysis, String> {
    let image = image::open(path).map_err(|error| format!("无法解码图片：{error}"))?;
    let preview = image.thumbnail(PREVIEW_MAX_EDGE, PREVIEW_MAX_EDGE).to_luma8();
    let pixelCount = f64::from(preview.width() * preview.height()).max(1.0);
    let darkRatio = preview.pixels().filter(|pixel| pixel[0] <= DARK_PIXEL_LIMIT).count() as f64 / pixelCount;
    let brightRatio = preview.pixels().filter(|pixel| pixel[0] >= BRIGHT_PIXEL_LIMIT).count() as f64 / pixelCount;
    let variance = laplacianVariance(&preview);
    let blurScore = (variance / (thresholds.blurVariance * 2.0) * 100.0).clamp(0.0, 100.0);
    let exposureStatus = if brightRatio >= thresholds.brightRatio { "over" } else if darkRatio >= thresholds.darkRatio {
        "under" } else { "normal" }.to_string();
    let reason = format!("清晰度 {:.0}；高光裁切 {:.1}%；暗部裁切 {:.1}%", blurScore, brightRatio * 100.0,
        darkRatio * 100.0);
    Ok(Analysis { blurScore, exposureStatus, reason, hash: differenceHash(&image) })
}

fn laplacianVariance(image: &GrayImage) -> f64 {
    if image.width() < 3 || image.height() < 3 { return 0.0; }
    let mut values = Vec::new();
    for y in 1..image.height() - 1 { for x in 1..image.width() - 1 {
        let center = i32::from(image.get_pixel(x, y)[0]) * 4;
        let neighbors = i32::from(image.get_pixel(x - 1, y)[0]) + i32::from(image.get_pixel(x + 1, y)[0])
            + i32::from(image.get_pixel(x, y - 1)[0]) + i32::from(image.get_pixel(x, y + 1)[0]);
        values.push(f64::from(center - neighbors));
    }}
    let mean = values.iter().sum::<f64>() / values.len() as f64;
    values.iter().map(|value| (value - mean).powi(2)).sum::<f64>() / values.len() as f64
}

fn differenceHash(image: &DynamicImage) -> u64 {
    let gray = image.resize_exact(HASH_SIZE + 1, HASH_SIZE, image::imageops::FilterType::Triangle).to_luma8();
    let mut hash = 0_u64;
    for y in 0..HASH_SIZE { for x in 0..HASH_SIZE { hash <<= 1;
        if gray.get_pixel(x, y)[0] > gray.get_pixel(x + 1, y)[0] { hash |= 1; }
    }}
    hash
}

fn thresholdsFor(preset: &str) -> Result<Thresholds, String> {
    match preset { "loose" => Ok(Thresholds { darkRatio: 0.48, brightRatio: 0.30, blurVariance: 60.0 }),
        "balanced" => Ok(Thresholds { darkRatio: 0.38, brightRatio: 0.22, blurVariance: 100.0 }),
        "strict" => Ok(Thresholds { darkRatio: 0.28, brightRatio: 0.14, blurVariance: 160.0 }),
        _ => Err("未知检测预设".to_string()) }
}

fn initializeDatabase(connection: &Connection) -> Result<(), String> {
    connection.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS projects(id INTEGER PRIMARY KEY,root_path TEXT UNIQUE NOT NULL);
        CREATE TABLE IF NOT EXISTS photos(id INTEGER PRIMARY KEY,project_id INTEGER NOT NULL,file_path TEXT UNIQUE NOT NULL,file_name TEXT NOT NULL,
        file_size INTEGER NOT NULL DEFAULT 0,modified_at INTEGER NOT NULL DEFAULT 0,rating INTEGER NOT NULL DEFAULT 0,rejected INTEGER NOT NULL DEFAULT 0,
        reviewed INTEGER NOT NULL DEFAULT 0,blur_score REAL NOT NULL DEFAULT 0,exposure_status TEXT NOT NULL DEFAULT 'normal',hash TEXT,
        duplicate_group TEXT,duplicate_best INTEGER NOT NULL DEFAULT 0,reason TEXT NOT NULL DEFAULT '',error TEXT,reviewed_at TEXT);")
        .map_err(dbError)
}

fn ensureProject(connection: &Connection, rootPath: &str) -> Result<i64, String> {
    connection.execute("INSERT OR IGNORE INTO projects(root_path) VALUES(?1)", [rootPath]).map_err(dbError)?;
    connection.query_row("SELECT id FROM projects WHERE root_path=?1", [rootPath], |row| row.get(0)).map_err(dbError)
}

fn isCached(connection: &Connection, projectId: i64, path: &Path, size: i64, modifiedAt: i64) -> Result<bool, String> {
    let result = connection.query_row("SELECT file_size,modified_at,error FROM photos WHERE project_id=?1 AND file_path=?2",
        params![projectId, path.to_string_lossy()], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?, row.get::<_, Option<String>>(2)?)));
    match result { Ok((oldSize, oldModified, error)) => Ok(oldSize == size && oldModified == modifiedAt && error.is_none()),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(false), Err(error) => Err(dbError(error)) }
}

fn saveAnalysis(connection: &Connection, projectId: i64, path: &Path, size: i64, modifiedAt: i64,
    analysis: Analysis) -> Result<(), String> {
    connection.execute("INSERT INTO photos(project_id,file_path,file_name,file_size,modified_at,blur_score,exposure_status,hash,reason,error)
        VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,NULL) ON CONFLICT(file_path) DO UPDATE SET file_size=excluded.file_size,
        modified_at=excluded.modified_at,blur_score=excluded.blur_score,exposure_status=excluded.exposure_status,hash=excluded.hash,
        reason=excluded.reason,error=NULL", params![projectId, path.to_string_lossy(), fileName(path), size, modifiedAt,
        analysis.blurScore, analysis.exposureStatus, analysis.hash.to_string(), analysis.reason]).map_err(dbError)?;
    Ok(())
}

fn saveFailure(connection: &Connection, projectId: i64, path: &Path, error: &str) -> Result<(), String> {
    connection.execute("INSERT INTO photos(project_id,file_path,file_name,error) VALUES(?1,?2,?3,?4)
        ON CONFLICT(file_path) DO UPDATE SET error=excluded.error", params![projectId, path.to_string_lossy(), fileName(path), error])
        .map_err(dbError)?;
    Ok(())
}

fn assignDuplicateGroups(connection: &Connection, projectId: i64) -> Result<(), String> {
    connection.execute("UPDATE photos SET duplicate_group=NULL,duplicate_best=0 WHERE project_id=?1", [projectId]).map_err(dbError)?;
    let mut statement = connection.prepare("SELECT id,hash,blur_score FROM photos WHERE project_id=?1 AND error IS NULL ORDER BY id")
        .map_err(dbError)?;
    let rows = statement.query_map([projectId], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?.parse::<u64>().unwrap_or(0),
        row.get::<_, f64>(2)?))).map_err(dbError)?.collect::<Result<Vec<_>, _>>().map_err(dbError)?;
    let mut groupNumber = 0;
    for leftIndex in 0..rows.len() { for rightIndex in leftIndex + 1..rows.len() {
        if (rows[leftIndex].1 ^ rows[rightIndex].1).count_ones() <= DUPLICATE_HASH_DISTANCE {
            groupNumber += 1;
            let group = format!("D{groupNumber:04}");
            let bestId = if rows[leftIndex].2 >= rows[rightIndex].2 { rows[leftIndex].0 } else { rows[rightIndex].0 };
            connection.execute("UPDATE photos SET duplicate_group=?1,duplicate_best=(id=?2) WHERE id IN(?3,?4)",
                params![group, bestId, rows[leftIndex].0, rows[rightIndex].0]).map_err(dbError)?;
            break;
        }
    }}
    Ok(())
}

fn loadPhotos(connection: &Connection, projectId: i64) -> Result<Vec<PhotoRecord>, String> {
    let mut statement = connection.prepare("SELECT id,file_path,file_name,rating,rejected,reviewed,blur_score,exposure_status,
        duplicate_group,duplicate_best,reason,error FROM photos WHERE project_id=?1 ORDER BY file_name").map_err(dbError)?;
    statement.query_map([projectId], mapPhoto).map_err(dbError)?.collect::<Result<Vec<_>, _>>().map_err(dbError)
}

fn loadPhoto(connection: &Connection, photoId: i64) -> Result<PhotoRecord, String> {
    connection.query_row("SELECT id,file_path,file_name,rating,rejected,reviewed,blur_score,exposure_status,duplicate_group,
        duplicate_best,reason,error FROM photos WHERE id=?1", [photoId], mapPhoto).map_err(dbError)
}

fn mapPhoto(row: &rusqlite::Row) -> rusqlite::Result<PhotoRecord> {
    Ok(PhotoRecord { id: row.get(0)?, file_path: row.get(1)?, file_name: row.get(2)?, preview_url: String::new(),
        rating: row.get(3)?, rejected: row.get(4)?, reviewed: row.get(5)?, blur_score: row.get(6)?,
        exposure_status: row.get(7)?, duplicate_group: row.get(8)?, duplicate_best: row.get(9)?, reason: row.get(10)?,
        error: row.get(11)? })
}

fn applyHistory(action: Option<PhotoSnapshot>, undo: bool, state: &State<AppState>) -> Result<Option<PhotoRecord>, String> {
    let Some(action) = action else { return Ok(None) };
    let connection = state.connection.lock().map_err(lockError)?;
    let (rating, rejected) = if undo { (action.beforeRating, action.beforeRejected) } else {
        (action.afterRating, action.afterRejected) };
    connection.execute("UPDATE photos SET rating=?1,rejected=?2 WHERE id=?3", params![rating, rejected, action.photoId])
        .map_err(dbError)?;
    if undo { state.redoStack.lock().map_err(lockError)?.push(action.clone()); } else {
        state.undoStack.lock().map_err(lockError)?.push(action.clone()); }
    Ok(Some(loadPhoto(&connection, action.photoId)?))
}

fn writeXmp(photo: &PhotoRecord, conflictMode: &str) -> Result<(), String> {
    let path = xmpPathFor(Path::new(&photo.file_path));
    if path.exists() && conflictMode == "skip" { return Ok(()); }
    let existing = if path.exists() && conflictMode == "merge" { fs::read_to_string(&path).unwrap_or_default() } else { String::new() };
    let preserved = existing.replace("</rdf:Description>", "").replace("</rdf:RDF></x:xmpmeta>", "");
    let prefix = if preserved.trim().is_empty() { "<x:xmpmeta xmlns:x=\"adobe:ns:meta/\"><rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\"><rdf:Description xmlns:xmp=\"http://ns.adobe.com/xap/1.0/\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\">".to_string() } else { preserved };
    let content = format!("{prefix}<xmp:Rating>{}</xmp:Rating><dc:label>{}</dc:label></rdf:Description></rdf:RDF></x:xmpmeta>",
        photo.rating, if photo.rejected { "Reject" } else { "Select" });
    atomicWrite(&path, content.as_bytes())
}

fn writeCsv(rootPath: &Path, photos: &[PhotoRecord]) -> Result<(), String> {
    let mut content = String::from("\u{feff}file_path,file_name,rating,rejected,blur_score,exposure_status,duplicate_group,duplicate_best,reviewed_at\n");
    for photo in photos { content.push_str(&format!("\"{}\",\"{}\",{},{},{:.2},{},\"{}\",{},\n",
        photo.file_path.replace('"', "\"\""), photo.file_name.replace('"', "\"\""), photo.rating, photo.rejected,
        photo.blur_score, photo.exposure_status, photo.duplicate_group.clone().unwrap_or_default(), photo.duplicate_best)); }
    atomicWrite(&rootPath.join(CSV_FILE_NAME), content.as_bytes())
}

fn atomicWrite(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let temporaryPath = path.with_extension(format!("{}.tmp", path.extension().and_then(|value| value.to_str()).unwrap_or("file")));
    fs::write(&temporaryPath, bytes).map_err(|error| error.to_string())?;
    fs::rename(&temporaryPath, path).map_err(|error| error.to_string())
}

fn xmpPathFor(path: &Path) -> PathBuf { path.with_extension("xmp") }
fn fileName(path: &Path) -> String { path.file_name().unwrap_or_default().to_string_lossy().to_string() }
fn isSupported(path: &Path) -> bool { matches!(path.extension().and_then(|value| value.to_str()).map(str::to_lowercase).as_deref(),
    Some("jpg" | "jpeg" | "png" | "webp")) }
fn dbError(error: rusqlite::Error) -> String { format!("项目数据库错误：{error}") }
fn lockError<T>(_: std::sync::PoisonError<T>) -> String { "内部状态暂时不可用".to_string() }

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default().plugin(tauri_plugin_dialog::init()).plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dataDirectory = app.path().app_data_dir()?;
            fs::create_dir_all(&dataDirectory)?;
            let connection = Connection::open(dataDirectory.join("nevercull.sqlite"))?;
            initializeDatabase(&connection).map_err(std::io::Error::other)?;
            app.manage(AppState { connection: Mutex::new(connection), undoStack: Mutex::new(Vec::new()),
                redoStack: Mutex::new(Vec::new()) });
            Ok(())
        }).invoke_handler(tauri::generate_handler![scan_directory, update_photo, undo_action, redo_action, preview_export,
            export_results]).run(tauri::generate_context!()).expect("NeverCull 启动失败");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn hashDistanceRecognizesIdenticalImages() {
        let image = DynamicImage::new_rgb8(20, 20);
        assert_eq!((differenceHash(&image) ^ differenceHash(&image)).count_ones(), 0);
    }
    #[test]
    fn presetsBecomeStricter() {
        let loose = thresholdsFor("loose").unwrap();
        let strict = thresholdsFor("strict").unwrap();
        assert!(loose.brightRatio > strict.brightRatio && loose.blurVariance < strict.blurVariance);
    }
}
