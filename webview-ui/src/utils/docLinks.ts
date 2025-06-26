/**
 * Utility for building Cybrosys Assista documentation links.
 *
 * @param path - The path after the docs root (no leading slash)
 * @param campaign - The context for the link (e.g. "welcome", "provider_docs", "tips", "error_tooltip")
 * @returns The full docs URL
 */
export function buildDocLink(path: string, campaign: string): string {
	// Remove any leading slash from path
	const cleanPath = path.replace(/^\//, "")
	const [basePath, hash] = cleanPath.split("#")
	const baseUrl = `https://docs.cybrosysassista.com/${basePath}`
	return hash ? `${baseUrl}#${hash}` : baseUrl
}
