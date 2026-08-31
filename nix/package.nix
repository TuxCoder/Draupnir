{
  buildNpmPackage,
  importNpmLock,
}:
buildNpmPackage {
  pname = "draupnir";
  version = "0.1";
  src = ./..;
  npmDeps = importNpmLock {
    npmRoot = ./..;
  };
  npmConfigHook = importNpmLock.npmConfigHook;

  installPhase = ''
    npm run build
    cp -r dist $out
  '';
}
