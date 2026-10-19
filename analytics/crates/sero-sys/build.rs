// Compiles the C shim over the header-only sero library (git submodule at vendor/sero).
//
// The shim uses no exceptions, RTTI, heap operators or thread-safe statics, so it
// links without a C++ standard library. That keeps cross-compiled binaries free of
// a libstdc++ version dependency.
fn main() {
    println!("cargo:rerun-if-changed=shim");
    println!("cargo:rerun-if-changed=vendor/sero");

    assert!(
        std::path::Path::new("vendor/sero/include/sero.hpp").exists(),
        "sero headers missing: run `git submodule update --init`"
    );

    cc::Build::new()
        .cpp(true)
        .std("c++17")
        .file("shim/sero_shim.cpp")
        .include("shim")
        // -isystem: sero's own warnings are not ours to fix.
        .flag("-isystem")
        .flag("vendor/sero/include")
        .flag("-fno-exceptions")
        .flag("-fno-rtti")
        .flag("-fno-threadsafe-statics")
        // Container assertions call into the C++ runtime (GCC 15 enables them by
        // default at -O0; libc++ hardening does the same).
        .flag("-U_GLIBCXX_ASSERTIONS")
        .define("_GLIBCXX_NO_ASSERTIONS", None)
        .define("_LIBCPP_HARDENING_MODE", "_LIBCPP_HARDENING_MODE_NONE")
        .warnings(true)
        .extra_warnings(true)
        .cpp_link_stdlib(None)
        .compile("sero_shim");
}
