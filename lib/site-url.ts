export function siteUrl() {
  try {
    return new URL(process.env.SITE_URL ?? "http://localhost:3000");
  } catch {
    return new URL("http://localhost:3000");
  }
}
