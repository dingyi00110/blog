import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import type { ExportPreview, PhotoRecord, PresetName, ScanResult } from './types';

export async function scanDirectory(directoryPath: string, preset: PresetName): Promise<ScanResult> {
  const result = await invoke<ScanResult>('scan_directory', { directory_path: directoryPath, preset });
  return { ...result, photos: result.photos.map((photo) => ({
    ...photo, preview_url: convertFileSrc(photo.file_path),
  })) };
}

export function updatePhoto(photoId: number, rating: number, rejected: boolean): Promise<PhotoRecord> {
  return invoke('update_photo', { photo_id: photoId, rating, rejected });
}

export function undoAction(): Promise<PhotoRecord | null> {
  return invoke('undo_action');
}

export function redoAction(): Promise<PhotoRecord | null> {
  return invoke('redo_action');
}

export function previewExport(projectId: number): Promise<ExportPreview> {
  return invoke('preview_export', { project_id: projectId });
}

export function exportResults(projectId: number, conflictMode: string): Promise<string[]> {
  return invoke('export_results', { project_id: projectId, conflict_mode: conflictMode });
}
