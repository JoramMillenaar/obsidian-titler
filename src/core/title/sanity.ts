/**
 * Whether a reply is broken output rather than a poor answer: what fp16 overflow on some GPUs
 * produces (replacement characters, one token repeated, only special tokens so nothing is
 * visible) or a reply with no usable list at all.
 */
export function looksUnusable(text: string, itemCount: number, outputTokens = 0): boolean {
	if (text.includes("�")) return true;
	if (/(.{1,6})\1{11,}/su.test(text)) return true;
	// One token can be a plain end of turn; many with nothing to show are special tokens only.
	if (text.trim() === "") return outputTokens > 1;
	return itemCount === 0;
}
