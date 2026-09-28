{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  name = "genius-zero-dev";
  packages = [
    pkgs.nodejs
    pkgs.pnpm
  ];
  shellHook = ''
    echo "=== Genius Zero Dev Shell ==="
    echo "Node: $(node --version)"
    echo "pnpm: $(pnpm --version)"
  '';
}
