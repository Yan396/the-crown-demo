use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager, WebviewWindow};

const MAX_SAVE_BYTES: usize = 8 * 1024 * 1024;

fn safe_key(key: &str) -> Result<String, String> {
    let valid = !key.is_empty()
        && key.len() <= 96
        && key
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "._-".contains(character));
    if valid {
        Ok(key.to_owned())
    } else {
        Err("invalid save key".into())
    }
}

fn save_path(app: &AppHandle, key: &str) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join(format!("{}.json", safe_key(key)?)))
}

#[tauri::command]
fn load_state(app: AppHandle, key: String) -> Result<Option<String>, String> {
    let path = save_path(&app, &key)?;
    match fs::read_to_string(path) {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn save_state(app: AppHandle, key: String, value: String) -> Result<(), String> {
    if value.len() > MAX_SAVE_BYTES {
        return Err("save exceeds size limit".into());
    }
    let path = save_path(&app, &key)?;
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, value).map_err(|error| error.to_string())?;
    if path.exists() {
        fs::remove_file(&path).map_err(|error| error.to_string())?;
    }
    fs::rename(temporary, path).map_err(|error| error.to_string())
}

#[tauri::command]
fn remove_state(app: AppHandle, key: String) -> Result<(), String> {
    let path = save_path(&app, &key)?;
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn set_fullscreen(window: WebviewWindow, fullscreen: bool) -> Result<(), String> {
    window
        .set_fullscreen(fullscreen)
        .map_err(|error| error.to_string())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            load_state,
            save_state,
            remove_state,
            set_fullscreen
        ])
        .run(tauri::generate_context!())
        .expect("failed to run The Crown");
}

