/**
 * Obsidian's name for a new note in every language it's translated to (key
 * `plugins.file-explorer.label-untitled-file` in obsidianmd/obsidian-translations). All of them
 * count, not just the current language's: a vault outlives a change of language, and syncs
 * between devices set to different ones.
 */
export const OBSIDIAN_UNTITLED_NAMES: readonly string[] = [
	"Untitled", "ርዕስ አልባ", "بدون عنوان", "Без назвы", "Неозаглавен файл", "নামহীন", "Sense títol",
	"Bez názvu", "Unavngivet", "Unbenannt", "Χωρίς Τίτλο", "Sin título", "بی‌نام", "Nimetön", "Sans titre",
	"Gan teideal", "Sen título", "ללא כותרת", "Bez naslova", "Névtelen", "Tanpa judul", "Senza nome",
	"無題のファイル", "უსათაურო", "War azwel", "គ្មានចំណងជើង", "무제", "Bez nosaukuma", "Tak bertajuk",
	"Bô miâ-tshing tóng-àn", "शीर्षकविहीन", "Naamloos", "Uten tittel", "Bez nazwy", "Sem título",
	"Fără titlu", "Без названия", "अनशीर्षकम्", "මාතෘකාවක් නොමැති (Untitled)", "Neimenovano", "I paemërtuar",
	"Без наслова", "Namnlös", "தலைப்பில்லாதது", "ยังไม่ได้ตั้งชื่อ", "Başlıksız", "Без назви",
	"Nomlanmagan", "Chưa đặt tên", "未命名",
];

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whether a note name is one of `names`, as Obsidian numbers them ("Untitled", "Untitled 3"), ignoring case. */
export function makeUntitledMatcher(names: Iterable<string>): (basename: string) => boolean {
	const unique = [...new Set([...names].map((name) => name.trim()).filter(Boolean))];
	if (unique.length === 0) return () => false;
	const pattern = new RegExp(`^(?:${unique.map(escapeRegExp).join("|")})(?: \\d+)?$`, "iu");
	return (basename) => pattern.test(basename.trim());
}
