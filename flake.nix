{
  description = "Description for the project";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
    treefmt-nix = {
      url = "github:numtide/treefmt-nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    inputs@{ self, flake-parts, ... }:
    flake-parts.lib.mkFlake { inherit inputs; } {
      imports = [
        inputs.treefmt-nix.flakeModule
      ];
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];

      perSystem = { self', pkgs, ... }: {
        packages.default = pkgs.callPackage ./nix/package.nix { };

        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            deno
            bun
            nodejs
            typescript
            matrix-sdk-crypto-nodejs
          ];
        };
        checks.package = self'.packages.default;

        treefmt = {
          programs.nixfmt.enable = true;
          #programs.prettier.enable = true;
        };
      };
    };
}
