import { useEffect, useMemo, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { exportResults, previewExport, redoAction, scanDirectory, undoAction, updatePhoto } from './api';
import type { FilterName, PhotoRecord, PresetName, ScanResult } from './types';

const FILTERS: Array<{ id: FilterName; label: string }> = [
  { id: 'all', label: '全部照片' }, { id: 'normal', label: '正常' }, { id: 'rejected', label: '建议剔除' },
  { id: 'over', label: '过曝' }, { id: 'under', label: '欠曝' }, { id: 'blur', label: '模糊' },
  { id: 'duplicate', label: '重复组' },
];

/** NeverCull 桌面工作台。 */
export function App() {
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [filter, setFilter] = useState<FilterName>('all');
  const [preset, setPreset] = useState<PresetName>('balanced');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('选择一个照片目录开始本地分析');

  const photos = useMemo(() => scanResult?.photos ?? [], [scanResult]);
  const selected = photos.find((photo) => photo.id === selectedId) ?? null;
  const visiblePhotos = useMemo(() => photos.filter((photo) => matchesFilter(photo, filter)), [photos, filter]);

  async function chooseDirectory() {
    const selectedPath = await open({ directory: true, multiple: false, title: '选择照片目录' });
    if (!selectedPath) return;
    setBusy(true);
    setMessage('正在扫描并分析照片…');
    try {
      const result = await scanDirectory(selectedPath, preset);
      setScanResult(result);
      setSelectedId(result.photos[0]?.id ?? null);
      setMessage(`完成：分析 ${result.scanned_count} 张，复用 ${result.cached_count} 张缓存`);
    } catch (error) {
      setMessage(`扫描失败：${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function applyEdit(rating: number, rejected: boolean) {
    if (!selected || !scanResult) return;
    const updated = await updatePhoto(selected.id, rating, rejected);
    replacePhoto({ ...updated, preview_url: selected.preview_url });
  }

  function replacePhoto(updated: PhotoRecord) {
    setScanResult((current) => current ? {
      ...current, photos: current.photos.map((photo) => photo.id === updated.id ? updated : photo),
    } : current);
  }

  async function runHistory(action: 'undo' | 'redo') {
    const updated = action === 'undo' ? await undoAction() : await redoAction();
    if (updated) replacePhoto({ ...updated, preview_url: selected?.preview_url ?? '' });
  }

  async function confirmExport() {
    if (!scanResult) return;
    const preview = await previewExport(scanResult.project_id);
    const confirmed = window.confirm(
      `将创建 ${preview.create_count} 个、更新 ${preview.update_count} 个 XMP，并生成 CSV。确认写入照片目录？`,
    );
    if (!confirmed) return;
    const failures = await exportResults(scanResult.project_id, 'merge');
    setMessage(failures.length ? `导出完成，${failures.length} 项失败` : 'XMP 与 CSV 导出完成');
  }

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (!selected || event.metaKey || event.ctrlKey) return;
      if (/^[1-5]$/.test(event.key)) void applyEdit(Number(event.key), selected.rejected);
      if (event.key.toLowerCase() === 'x') void applyEdit(selected.rating, !selected.rejected);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  });

  return <main className="app-shell">
    <header>
      <div><span className="eyebrow">LOCAL PHOTO WORKSPACE</span><h1>NeverCull</h1></div>
      <div className="header-actions">
        <select value={preset} onChange={(event) => setPreset(event.target.value as PresetName)}>
          <option value="loose">宽松</option><option value="balanced">均衡</option>
          <option value="strict">严格</option>
        </select>
        <button className="secondary" onClick={() => void runHistory('undo')}>撤销</button>
        <button className="secondary" onClick={() => void runHistory('redo')}>重做</button>
        <button onClick={() => void chooseDirectory()} disabled={busy}>
          {busy ? '分析中…' : '选择目录'}
        </button>
      </div>
    </header>
    <section className="status">
      <span>{message}</span>
      {scanResult && <span>{scanResult.elapsed_ms} ms · 失败 {scanResult.failed_count}</span>}
    </section>
    <div className="workspace">
      <aside><h2>筛选</h2>{FILTERS.map((item) => <button key={item.id}
        className={filter === item.id ? 'filter active' : 'filter'} onClick={() => setFilter(item.id)}>
        {item.label}<b>{photos.filter((photo) => matchesFilter(photo, item.id)).length}</b>
      </button>)}
        <button className="export" disabled={!scanResult} onClick={() => void confirmExport()}>
          导出 XMP + CSV
        </button>
      </aside>
      <section className="gallery">{visiblePhotos.map((photo) => <button key={photo.id}
        className={selectedId === photo.id ? 'photo-card selected' : 'photo-card'}
        onClick={() => setSelectedId(photo.id)}>
        <img src={photo.preview_url} alt={photo.file_name} loading="lazy"/>
        <span className="badges">{photo.rejected && <i>剔除</i>}<i>{photo.exposure_status}</i>
          {photo.duplicate_group && <i>重复</i>}
        </span>
        <strong>{photo.file_name}</strong>
        <span>{'★'.repeat(photo.rating) || '未评级'} · 清晰度 {photo.blur_score}</span>
      </button>)}</section>
      <aside className="inspector">{selected ? <>
        <img src={selected.preview_url} alt={selected.file_name}/><h2>{selected.file_name}</h2>
        <p>{selected.reason}</p><dl><dt>曝光</dt><dd>{selected.exposure_status}</dd>
          <dt>清晰度</dt><dd>{selected.blur_score}</dd>
          <dt>重复组</dt><dd>{selected.duplicate_group ?? '无'}</dd>
        </dl>
        <div className="stars">{[1, 2, 3, 4, 5].map((rating) =>
          <button key={rating} onClick={() => void applyEdit(rating, selected.rejected)}>★</button>)}</div>
        <button className={selected.rejected ? 'keep' : 'reject'}
          onClick={() => void applyEdit(selected.rating, !selected.rejected)}>
          {selected.rejected ? '恢复保留' : '标记剔除'}
        </button>
        </> : <div className="empty">选择照片查看检测依据</div>}</aside></div>
  </main>;
}

function matchesFilter(photo: PhotoRecord, filter: FilterName): boolean {
  if (filter === 'all') return true;
  if (filter === 'normal') return !photo.rejected && photo.exposure_status === 'normal' && photo.blur_score >= 50;
  if (filter === 'rejected') return photo.rejected;
  if (filter === 'over' || filter === 'under') return photo.exposure_status === filter;
  if (filter === 'blur') return photo.blur_score < 50;
  return photo.duplicate_group !== null;
}
