export type FilterName = 'all' | 'normal' | 'rejected' | 'over' | 'under' | 'blur' | 'duplicate';
export type PresetName = 'loose' | 'balanced' | 'strict';

export interface PhotoRecord {
  id: number;
  file_path: string;
  file_name: string;
  preview_url: string;
  rating: number;
  rejected: boolean;
  reviewed: boolean;
  blur_score: number;
  exposure_status: 'normal' | 'over' | 'under';
  duplicate_group: string | null;
  duplicate_best: boolean;
  reason: string;
  error: string | null;
}

export interface ScanResult {
  project_id: number;
  scanned_count: number;
  cached_count: number;
  failed_count: number;
  elapsed_ms: number;
  photos: PhotoRecord[];
}

export interface ExportPreview {
  create_count: number;
  update_count: number;
  skip_count: number;
  paths: string[];
}
