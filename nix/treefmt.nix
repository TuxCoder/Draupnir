{ ... }: {
  programs.nixfmt.enable = true;

  programs.prettier.enable = true;
  settings.global.excludes = [
    "src/__generated__/**"
  ];
}
