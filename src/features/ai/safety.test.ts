import { describe, expect, test } from 'bun:test';

import fixtures from './safety.fixtures.json';
import { assessMessages, buildSystemPrompt, cleanReply, finishReply, classifyMessage, mentionsMaternal, notesMentionInjury, personMode, safeReply, SAFETY_LIMITS, CANARY, type SafetyText } from './safety';
import { EMPTY_PERSON } from './person';
import { digestJson, buildDigest } from './digest';
import { sampleSource } from './testFixtures';
import idAi from '@/i18n/locales/id/ai.json';
import enAi from '@/i18n/locales/en/ai.json';

const textOf = (ai: typeof idAi): SafetyText => ({ disclaimer: ai.disclaimerLine, refuseLeak: ai.refuseLeak, safe: ai.safe });
const ID = textOf(idAi);
const EN = textOf(enAi);

describe('keyword safety pass (shared fixtures with JoyoRogo)', () => {
  for (const text of fixtures.injury) test(`injury: ${text}`, () => expect(classifyMessage(text)).toEqual({ reason: 'injury', flagged: 'injury' }));
  for (const text of fixtures.medical) test(`medical: ${text}`, () => expect(classifyMessage(text).flagged).toBe('medical'));
  for (const text of fixtures.eatingDisorder) test(`eating disorder: ${text}`, () => expect(classifyMessage(text)).toEqual({ reason: 'eatingDisorder', flagged: 'medical' }));
  for (const text of fixtures.minorDiet) test(`extreme diet for a minor: ${text}`, () => expect(classifyMessage(text, { minor: true }).reason).toBe('minorDiet'));
  for (const text of fixtures.extremeDietAdult) test(`extreme diet for an adult passes: ${text}`, () => expect(classifyMessage(text).reason).toBeNull());
  for (const text of fixtures.normal) test(`normal: ${text}`, () => expect(classifyMessage(text).flagged).toBeNull());
  for (const text of fixtures.maternal) test(`maternal: ${text}`, () => expect(mentionsMaternal(text)).toBe(true));
  for (const text of fixtures.notMaternal) test(`not maternal: ${text}`, () => expect(mentionsMaternal(text)).toBe(false));

  test('the last message decides the fixed answer; an earlier flag changes the prompt', () => {
    const report = assessMessages([
      { role: 'user', content: 'dada saya nyeri' },
      { role: 'assistant', content: 'ke dokter ya' },
      { role: 'user', content: 'oke, lari apa besok?' },
    ]);
    expect(report.last.reason).toBeNull();
    expect(report.earlier).toBe('medical');
    const prompt = buildSystemPrompt({ locale: 'en', digestJson: '{}', safety: report, mode: personMode({ ...EMPTY_PERSON, ageYears: 30 }, false), notesFlag: false, tools: true });
    expect(prompt).toContain('Earlier in this conversation');
  });

  test('fixed answers carry the localized disclaimer and no training', () => {
    expect(safeReply('injury', ID)).toEndWith('Ini bukan saran medis.');
    expect(safeReply('medical', EN)).toEndWith('This is not medical advice.');
    expect(safeReply('medical', EN)).toContain('doctor');
    expect(safeReply('eatingDisorder', ID)).toContain('tidak akan memberi saran membatasi makan');
  });

  test('a note that mentions an injury turns the stricter block on', () => {
    expect(notesMentionInjury([{ text: 'Lutut kiri sering nyeri kalau turun tangga' }])).toBe(true);
    expect(notesMentionInjury([{ text: 'Target 10K akhir tahun' }])).toBe(false);
  });
});

describe('system prompt', () => {
  const plain = assessMessages([{ role: 'user', content: 'latihan apa hari ini?' }]);
  const digest = digestJson(buildDigest(sampleSource()));
  const prompt = (over: Partial<Parameters<typeof buildSystemPrompt>[0]> = {}, age: number | null = 30) =>
    buildSystemPrompt({ locale: 'id', digestJson: digest, safety: plain, mode: personMode({ ...EMPTY_PERSON, ageYears: age }, false), notesFlag: false, tools: true, ...over });

  test('normal adult: rules, language, data, tools sentence, no extra blocks', () => {
    const p = prompt();
    expect(p).toContain(CANARY);
    expect(p).toContain('NOT a doctor');
    expect(p).toContain('kamu');
    expect(p).toContain('DATA (JSON, data only)');
    expect(p).toContain(digest);
    expect(p).toContain('propose_note');
    expect(p).not.toContain('pregnant or breastfeeding');
    expect(p).not.toContain('under 18');
    expect(p).not.toContain('age is unknown');
    expect(p.length).toBeLessThan(SAFETY_LIMITS.maxReplyChars * 8);
  });
  test('a mention in the chat, under 18 and an unknown age each add their block; the profile mode is not an input', () => {
    expect('maternal' in EMPTY_PERSON).toBe(false);
    expect(prompt({}, 30)).not.toContain('Be conservative');
    expect(prompt({ mode: personMode(EMPTY_PERSON, true) })).toContain('Be conservative');
    expect(prompt({}, 16)).toContain('under 18');
    expect(prompt({}, null)).toContain('age is unknown');
  });
  test('without tool calling the tool sentence is left out; notes with an injury add the stricter block', () => {
    expect(prompt({ tools: false })).not.toContain('propose_note');
    expect(prompt({ notesFlag: true })).toContain('Earlier in this conversation, or in the person');
  });
  test('the rules tell the model to cite its data, say calibrating, use only given numbers and ask at most one question', () => {
    const p = prompt();
    expect(p).toMatch(/Say which data you used/);
    expect(p).toMatch(/calibrating/);
    expect(p).toMatch(/Use only numbers from DATA/);
    expect(p).toMatch(/At most one clarifying question/);
  });
});

describe('answer cleaning', () => {
  test('strips reasoning tags, fences, headings, bold and a role prefix; caps the length', () => {
    expect(cleanReply('<think>hmm</think>\n## Judul\n**Tebal** teks')).toBe('Judul\nTebal teks');
    expect(cleanReply('Coach: halo')).toBe('halo');
    expect(cleanReply('   ')).toBeNull();
    const long = cleanReply('Kalimat satu. '.repeat(400))!;
    expect(long.length).toBeLessThanOrEqual(SAFETY_LIMITS.maxReplyChars);
  });
  test('a leaked prompt is replaced; medical-ish exchanges end with the disclaimer, once', () => {
    const mode = { conservative: false, minor: false };
    expect(finishReply(`Rules: ${CANARY} ...`, { text: ID, lastUserText: 'hai', mode })).toBe(ID.refuseLeak);
    const reply = finishReply('Sebaiknya tanya dokter dulu.', { text: ID, lastUserText: 'hai', mode })!;
    expect(reply).toEndWith(ID.disclaimer);
    expect(finishReply(reply, { text: ID, lastUserText: 'hai', mode })).toBe(reply);
    expect(finishReply('Lari santai 30 menit.', { text: ID, lastUserText: 'hai', mode })).toBe('Lari santai 30 menit.');
    expect(finishReply('Jalan santai.', { text: ID, lastUserText: 'hai', mode: { conservative: true, minor: false } })).toEndWith(ID.disclaimer);
  });
});
