fn main() {
    // Expose Cargo's TARGET so engine.rs can locate the platform-specific
    // sidecar folder (e.g. `upiqal-engine-aarch64-apple-darwin`) at runtime.
    println!(
        "cargo:rustc-env=TARGET_TRIPLE={}",
        std::env::var("TARGET").unwrap_or_else(|_| "unknown".into())
    );
    tauri_build::build()
}
