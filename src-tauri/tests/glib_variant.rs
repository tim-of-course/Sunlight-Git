// RUSTSEC-2024-0429 can crash only after optimization. Keep the mutable FFI
// out-pointer backport until Tauri's GTK3 stack can use a patched GLib release.
#[cfg(target_os = "linux")]
#[test]
fn glib_string_iteration_survives_optimization() {
    use glib::variant::ToVariant;

    let value = ["one", "two", "three"].as_slice().to_variant();
    let mut iter = value.array_iter_str().unwrap();
    assert_eq!(iter.next(), Some("one"));
    assert_eq!(iter.next_back(), Some("three"));
    assert_eq!(iter.last(), Some("two"));
    assert_eq!(value.array_iter_str().unwrap().nth(1), Some("two"));
    assert_eq!(value.array_iter_str().unwrap().nth_back(1), Some("two"));
}
