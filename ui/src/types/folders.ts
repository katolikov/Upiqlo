export type PairingMode = "filename" | "index";

export interface FolderPair {
  reference_path: string;
  target_path: string;
  label: string;
}

export interface FolderScanResponse {
  reference_dir: string;
  target_dir: string;
  mode: PairingMode;
  pairs: FolderPair[];
  unmatched_reference: string[];
  unmatched_target: string[];
}
