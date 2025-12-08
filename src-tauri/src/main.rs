#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Check if a file path was provided as command line argument
    let args: Vec<String> = std::env::args().collect();
    if args.len() > 1 {
        // Store the file path to be opened after app initialization
        std::env::set_var("KORPPI_OPEN_FILE", &args[1]);
    }
    
    korppi::run();
}
