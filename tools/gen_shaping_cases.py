#!/usr/bin/env python3
"""Record what HarfBuzz makes of a list of Indic words with the bundled
fonts, as the expected results of ceangal/src/indic_test.almd
(tests/shaping/indic.txt).

Usage (needs uharfbuzz):  python3 tools/gen_shaping_cases.py

Each line: font<TAB>words<TAB>glyphs, where glyphs are
gid:cluster:x_advance:x_offset:y_offset separated by spaces (font units;
clusters are code point indices).
"""
import os

import uharfbuzz as hb

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ZWJ, ZWNJ = "‍", "‌"

WORDS = {
    "devanagari": [
        "नमस्ते", "हिन्दी", "क्षत्रिय", "धर्म", "कार्य", "प्रेम", "श्री", "द्वारा", "विद्यालय", "स्त्री",
        "अर्थ", "पूर्ण", "ज़िंदगी", "क़लम", "किताब", "कृपया", "हृदय", "ट्रक", "राष्ट्र", "उत्तर", "शब्द",
        "संस्कृत", "ख़्वाब", "सर्वश्रेष्ठ", "कर्ता", "मूर्ति", "दर्शन", "पर्यावरण", "आर्ट्स", "ड्राइवर",
        "ज्ञान", "क्" + ZWJ + "ष", "क्" + ZWNJ + "ष", "कि", "र्कि", "स्थिति", "अंग्रेज़ी", "ॐ", "ि",
        "देवनागरी", "भाषा", "कर्मों", "आँख", "दुःख", "रु", "रू", "हिंदी में लिखा", "द्ध", "ह्म", "त्त्व",
        # stacks, reph with matras, eyelash ra, Marathi / Nepali / Sanskrit
        "श्रृंगार", "र्द्ध", "कार्त्स्न्य", "ज्योत्स्ना", "उज्ज्वल", "महाराष्ट्र", "र्" + ZWJ + "य", "प्र्य",
        "हर्षित", "पूर्वी", "वर्षों", "कर्त्तव्य", "अर्ध्य", "सूर्योदय", "धर्मेंद्र", "नेपाली", "मराठी",
        "ॐ नमः शिवाय", "क्लृप्त", "द्ग", "ङ्क", "ट्ठ", "ह्न", "ह्य", "श्व", "त्र्य", "ऋषि", "ॠ", "ॡ",
        "क़्", "फ़िल्म", "ज़्यादा", "ऑफ़िस", "डॉक्टर", "बैंक", "१२३ रुपये।", "(हिन्दी)", "क्" + ZWNJ,
        "र्र", "र्रा", "र्कं", "र्क्ष", "किं", "र्कीं", "ष्ट्र्य",
    ],
    "bengali": [
        "বাংলা", "ভাষা", "আমার", "সোনার", "কৌতূহল", "ক্ষমা", "স্বাধীনতা", "রবীন্দ্রনাথ", "ঠাকুর", "কর্ম",
        "বর্ষা", "শ্রী", "প্রেম", "ক্রিকেট", "স্কুল", "বিজ্ঞান", "যুক্তরাষ্ট্র", "মৌমাছি", "গ্রাম", "ধর্ম",
        "র" + ZWJ + "্যাব", "অর্থনীতি", "কি", "কো", "কৈ", "চিত্র", "দুঃখ", "ৎ", "রু", "শু", "হৃদয়",
        "সত্যি", "কর্তৃপক্ষ", "আমি বাংলায় গান গাই",
        "ক্ষ্ম", "জ্ঞ", "ন্ত্র", "স্ত্র", "র্ক্ষ", "অর্ঘ্য", "কার্য", "সূর্য", "রাষ্ট্র", "ব্র্যান্ড",
        "উৎসব", "ৎস", "বিদ্যুৎ", "শৃঙ্খলা", "দ্ধ", "ঙ্ক", "ঞ্চ", "হ্ম", "ক্ত", "গ্ধ", "কোর্ট", "কৌ",
        "ড়", "ঢ়", "য়", "১২৩ টাকা।", "র্য", "র‍্য",
    ],
    "tamil": [
        "தமிழ்", "வணக்கம்", "கொடு", "கோவில்", "கௌரவம்", "ஸ்ரீ", "க்ஷ", "நன்றி", "பள்ளி", "மொழி",
        "இந்தியா", "கை", "டி", "டீ", "டு", "டூ", "சென்னை", "ழ்", "பெண்", "போ", "வௌவால்", "ஃ",
        "யாதும் ஊரே யாவரும் கேளிர்",
        "ஸ்ரீலங்கா", "க்ஷேத்திரம்", "ஜ்ஞ", "ஷோ", "ஹௌ", "ஓ", "ஔ", "ணொ", "றோ", "னை", "ளை", "லை",
        "திருக்குறள்", "௧௨௩", "ஶ்ரீ", "கி", "கீ", "சு", "சூ", "நு", "நூ", "பெ", "பே",
    ],
    "gurmukhi": [
        "ਪੰਜਾਬੀ", "ਗੁਰਮੁਖੀ", "ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ", "ਧੰਨਵਾਦ", "ਪ੍ਰੇਮ", "ਕ੍ਰਿਪਾ", "ਸ੍ਵਰ", "ਖ਼ਾਲਸਾ", "ਜ਼ਿੰਦਗੀ", "ਫ਼ਰਕ",
        "ਕਿੱਥੇ", "ਬੱਚਾ", "ਹੱਥ", "ਦੁੱਧ", "ਪੈਸਾ", "ਕੌਣ", "ਸ਼ੇਰ", "ਲ਼", "ਗੁਰੂ", "ਕਿ", "ਕੀ", "ਕੁ", "ਕੂ", "ਕੇ",
        "ਕੈ", "ਕੋ", "ਕੌ", "ਕੰ", "ਕਾਂ", "ਸ੍ਹ", "ਪੜ੍ਹ", "ਚ੍ਹ", "ਅੱਖ", "ਰ੍ਕ", "ਕ੍ਯ",
    ],
    "gujarati": [
        "ગુજરાતી", "નમસ્તે", "ધર્મ", "કાર્ય", "પ્રેમ", "શ્રી", "દ્વારા", "વિદ્યાલય", "સ્ત્રી", "અર્થ", "પૂર્ણ",
        "કૃપા", "હૃદય", "ટ્રક", "રાષ્ટ્ર", "ક્ષ", "જ્ઞ", "સંસ્કૃત", "કિ", "ર્કિ", "સ્થિતિ", "દ્ધ", "ત્ત્વ",
        "ભાષા", "ગાંધી", "અમદાવાદ", "કૉ", "ર્કીં", "િ",
    ],
    "telugu": [
        "తెలుగు", "నమస్కారం", "ధన్యవాదాలు", "ప్రేమ", "శ్రీ", "క్ష", "జ్ఞ", "స్త్రీ", "కర్మ", "ధర్మం", "అర్థం",
        "సూర్యుడు", "క్రి", "ర్క", "ర్" + ZWJ + "క", "కె", "కే", "కై", "కొ", "కో", "కౌ", "కృ", "హైదరాబాదు",
        "విద్యార్థి", "రాష్ట్రం", "ద్వ", "త్ర్య", "కం", "క్క", "ష్ట్ర",
    ],
    "kannada": [
        "ಕನ್ನಡ", "ನಮಸ್ಕಾರ", "ಧನ್ಯವಾದ", "ಪ್ರೇಮ", "ಶ್ರೀ", "ಕ್ಷ", "ಜ್ಞ", "ಸ್ತ್ರೀ", "ಕರ್ಮ", "ಧರ್ಮ", "ಅರ್ಥ",
        "ಸೂರ್ಯ", "ಕ್ರಿ", "ರ್ಕ", "ರ್" + ZWJ + "ಕ", "ಕೆ", "ಕೇ", "ಕೈ", "ಕೊ", "ಕೋ", "ಕೌ", "ಕೃ", "ಕೀ", "ಬೆಂಗಳೂರು",
        "ವಿದ್ಯಾರ್ಥಿ", "ರಾಷ್ಟ್ರ", "ದ್ವ", "ತ್ರ್ಯ", "ಕಂ", "ಕ್ಕ", "ಕ್ರ್ಯ",
    ],
    "malayalam": [
        "മലയാളം", "നമസ്കാരം", "നന്ദി", "പ്രേമം", "ശ്രീ", "ക്ഷ", "ജ്ഞ", "സ്ത്രീ", "കർമ്മം", "ധർമ്മം", "അർത്ഥം",
        "സൂര്യൻ", "ക്രി", "ൎക", "കെ", "കേ", "കൈ", "കൊ", "കോ", "കൗ", "കൃ", "കേരളം", "വിദ്യാർത്ഥി",
        "രാഷ്ട്രം", "ദ്വ", "ത്ര്യ", "കം", "ക്ക", "ണ്ട", "ന്റെ", "മ്മ", "ല്ല", "ങ്ങൾ", "ർക്ക", "ക്ര്യ",
    ],
}


ARABIC = {
    "arabic": [
        "مرحبا", "العربية", "السلام عليكم", "لا", "لأ", "لإ", "لآ", "الله", "بِسْمِ اللَّهِ", "مُحَمَّد",
        "كتب", "كَتَبَ", "مدرسة", "شكرا", "فارسی", "می‌خواهم", "اردو", "پاکستان", "گفتگو", "ژاله",
        "ب‍ب", "ب‌ب", "قلّم", "ىٰ", "ءَ", "سـلام", "فى", "ئ", "ﻻ", "(كتب)", "نحن نكتب",
        "لِلْ", "بَيْتٌ", "يَّ", "مستشفى", "تحتاج", "إسلام", "أهلا وسهلا",
    ],
}


def write(cases, dst, direction=None):
    out = []
    for name, words in cases.items():
        blob = hb.Blob.from_file_path(os.path.join(ROOT, "assets", "fonts", name + ".ttf"))
        font = hb.Font(hb.Face(blob))
        for w in words:
            buf = hb.Buffer()
            buf.add_codepoints([ord(c) for c in w])
            buf.guess_segment_properties()
            if direction:
                buf.direction = direction
            hb.shape(font, buf, {})
            glyphs = " ".join(
                f"{i.codepoint}:{i.cluster}:{p.x_advance}:{p.x_offset}:{p.y_offset}"
                for i, p in zip(buf.glyph_infos, buf.glyph_positions))
            out.append(f"{name}\t{w}\t{glyphs}")
    path = os.path.join(ROOT, "tests", "shaping", dst)
    open(path, "w", encoding="utf-8").write("\n".join(out) + "\n")
    print(f"{os.path.relpath(path, ROOT)}: {len(out)} cases")


def main():
    # Arabic runs are shaped right to left as a whole (neutrals included)
    write(ARABIC, "arabic.txt", "rtl")
    out = []
    for name, words in WORDS.items():
        blob = hb.Blob.from_file_path(os.path.join(ROOT, "assets", "fonts", name + ".ttf"))
        font = hb.Font(hb.Face(blob))
        for w in words:
            buf = hb.Buffer()
            buf.add_codepoints([ord(c) for c in w])
            buf.guess_segment_properties()
            hb.shape(font, buf, {})
            glyphs = " ".join(
                f"{i.codepoint}:{i.cluster}:{p.x_advance}:{p.x_offset}:{p.y_offset}"
                for i, p in zip(buf.glyph_infos, buf.glyph_positions))
            out.append(f"{name}\t{w}\t{glyphs}")
    dst = os.path.join(ROOT, "tests", "shaping", "indic.txt")
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    open(dst, "w", encoding="utf-8").write("\n".join(out) + "\n")
    print(f"{os.path.relpath(dst, ROOT)}: {len(out)} cases")


if __name__ == "__main__":
    main()
