/* The camera films the running product. The frame renderer has a separate,
   deterministic browser and deliberately does not use these launch arguments. */
export function captureBrowserArgs(platform = process.platform, arch = process.arch): string[] {
  // Measured on Apple Silicon: headless defaults to SwiftShader and a 450 ms
  // pointer approach on a WebGL app took 84 s. Metal preserves capture density
  // while giving the product its native GPU. Other hosts keep their current path.
  return platform === "darwin" && arch === "arm64" ? ["--enable-gpu", "--use-gl=angle", "--use-angle=metal"] : [];
}
