{
  makeBinaryWrapper,
  sqlite,
  python3,
  stdenv,
  cctools,
  buildNpmPackage,
  importNpmLock,
  matrix-sdk-crypto-nodejs,
  srcOnly,
  nodejs_26,
  removeReferencesTo,
  lib,
}:
let
  nodeSources = srcOnly nodejs_26;
in
buildNpmPackage (finalAttrs: {
  pname = "draupnir";
  version = "3.2";
  src = ./..;
  npmDeps = importNpmLock {
    npmRoot = ./..;
  };
  npmConfigHook = importNpmLock.npmConfigHook;

  nativeBuildInputs = [
    makeBinaryWrapper
    sqlite
    python3
  ]
  ++ lib.optional stdenv.hostPlatform.isDarwin cctools.libtool;

  preBuild = ''
    # install proper version and branch info
    echo "${finalAttrs.version}-nix" > apps/draupnir/version.txt
    echo "main" > apps/draupnir/branch.txt

    # we already set the version and branch above
    sed -i "/build:assets/d" apps/draupnir/package.json

    # Replace matrix-sdk-crypto-nodejs with nixpkgs version
    nodeCryptoPath="node_modules/@matrix-org/matrix-sdk-crypto-nodejs"
    rm -rf "$nodeCryptoPath"
    ln -s ${matrix-sdk-crypto-nodejs}/lib/node_modules/@matrix-org/matrix-sdk-crypto-nodejs \
      "$nodeCryptoPath"

  '';

  postInstall = ''

    # build better-sqlite3
    betterSqlitePath="node_modules/better-sqlite3"
    pushd "$betterSqlitePath"
    npm run build-release --offline --nodedir="${nodeSources}"
    rm -rf build/Release/{.deps,obj,obj.target,test_extension.node}
    find build -type f -exec \
          ${lib.getExe removeReferencesTo} -t "${nodeSources}" {} \;
    popd

    mkdir -p $out/lib/node_modules/draupnir
    mkdir $out/bin
    # Install outputs
    mv ./node_modules ./packages ./apps/draupnir/dist ./apps/draupnir/version.txt ./apps/draupnir/branch.txt ./apps/draupnir/package.json $out/lib/node_modules/draupnir
    # Fix dangling symlink pointing to relative path ../apps/draupnir
    rm $out/lib/node_modules/draupnir/node_modules/draupnir

    # Create wrapper executable
    makeWrapper ${lib.getExe nodejs_26} $out/bin/draupnir \
      --add-flags "--enable-source-maps" \
      --add-flags "$out/lib/node_modules/draupnir/dist/index.js"

  '';
})
