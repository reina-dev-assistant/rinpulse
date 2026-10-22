import * as Linking from 'expo-linking';
import { memo, useMemo, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { parseMarkdown, type Align, type Block, type Inline, type ListItem } from '@/features/ai/markdown/parse';
import { fontSize, monoFont, spacing, useColors, useTheme } from '@/theme';

interface MarkdownProps {
  text: string;
  /** The answer is still arriving: an unclosed `**`, backtick or code fence renders as what it is so far. */
  streaming?: boolean;
  /** Overrides the text color, for the colored user bubble. Chips, code and tables keep their own readable surface. */
  color?: string;
}

interface Ctx {
  color?: string;
  muted: boolean;
  bold: string;
  link: string;
  chipBackground: string;
  chipColor: string;
  hairline: string;
}

const COLUMN_MIN = 72;
const COLUMN_MAX = 200;
/** Rough width of one caption character, to size table columns without measuring. */
const CHAR_WIDTH = 7;

async function openLink(href: string): Promise<void> {
  try {
    await Linking.openURL(href);
  } catch {
    // An unopenable link does nothing, as in a browser with no handler.
  }
}

function plainLength(nodes: Inline[]): number {
  let total = 0;
  for (const node of nodes) {
    if (node.t === 'text' || node.t === 'code') total += node.s.length;
    else if (node.t === 'br') total += 1;
    else total += plainLength(node.c);
  }
  return total;
}

function renderInline(nodes: Inline[], ctx: Ctx): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.t) {
      case 'text':
        return node.s;
      case 'br':
        return '\n';
      case 'bold':
        return (
          <Text key={i} style={{ fontFamily: ctx.bold }}>
            {renderInline(node.c, ctx)}
          </Text>
        );
      case 'italic':
        return (
          <Text key={i} style={styles.italic}>
            {renderInline(node.c, ctx)}
          </Text>
        );
      case 'code':
        return (
          <Text key={i} style={[styles.inlineCode, { backgroundColor: ctx.chipBackground, color: ctx.chipColor }]}>
            {node.s}
          </Text>
        );
      case 'link':
        return (
          <Text
            key={i}
            accessibilityRole="link"
            onPress={() => void openLink(node.href)}
            style={[styles.link, { color: ctx.link }]}>
            {renderInline(node.c, ctx)}
          </Text>
        );
    }
  });
}

function Items({ items, ctx, ordered }: { items: ListItem[]; ctx: Ctx; ordered: boolean }) {
  const widest = ordered ? Math.max(...items.map((item) => (item.n === null ? 1 : String(item.n).length + 1))) : 1;
  const markerWidth = widest >= 3 ? 28 : 20;
  return (
    <View style={styles.list}>
      {items.map((item, i) => (
        <View key={i} style={[styles.item, { paddingLeft: item.depth * spacing.lg }]}>
          <AppText
            color={ctx.color}
            muted={ctx.muted}
            style={[styles.marker, { minWidth: markerWidth }, item.n !== null && styles.number]}>
            {item.n === null ? (item.depth === 0 ? '\u2022' : '\u25E6') : `${item.n}.`}
          </AppText>
          <AppText selectable color={ctx.color} muted={ctx.muted} style={styles.itemText}>
            {renderInline(item.c, ctx)}
          </AppText>
        </View>
      ))}
    </View>
  );
}

function Table({
  head,
  rows,
  align,
  ctx,
}: {
  head: Inline[][];
  rows: Inline[][][];
  align: Align[];
  ctx: Ctx;
}) {
  const { radius } = useTheme();
  const widths = head.map((cell, c) => {
    let longest = plainLength(cell);
    for (const row of rows) longest = Math.max(longest, plainLength(row[c] ?? []));
    return Math.min(COLUMN_MAX, Math.max(COLUMN_MIN, longest * CHAR_WIDTH + spacing.md * 2));
  });
  const renderRow = (cells: Inline[][], header: boolean, key: number) => (
    <View key={key} style={[styles.row, !header && { borderTopColor: ctx.hairline, borderTopWidth: StyleSheet.hairlineWidth }]}>
      {widths.map((width, c) => (
        <AppText
          key={c}
          selectable
          variant={header ? 'bodyStrong' : 'caption'}
          color={ctx.chipColor}
          style={[styles.cell, header && styles.headerCell, { width, textAlign: align[c] ?? 'left' }]}>
          {renderInline(cells[c] ?? [], ctx)}
        </AppText>
      ))}
    </View>
  );
  return (
    <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false} style={styles.tableScroll}>
      <View style={[styles.table, { backgroundColor: ctx.chipBackground, borderRadius: radius.input }]}>
        {renderRow(head, true, -1)}
        {rows.map((row, r) => renderRow(row, false, r))}
      </View>
    </ScrollView>
  );
}

function CodeBlock({ text, ctx }: { text: string; ctx: Ctx }) {
  const { radius } = useTheme();
  return (
    <ScrollView
      horizontal
      nestedScrollEnabled
      style={[styles.codeScroll, { backgroundColor: ctx.chipBackground, borderRadius: radius.input }]}
      contentContainerStyle={styles.codeContent}>
      <AppText selectable variant="mono" color={ctx.chipColor}>
        {text}
      </AppText>
    </ScrollView>
  );
}

function Blocks({ blocks, ctx }: { blocks: Block[]; ctx: Ctx }) {
  return (
    <>
      {blocks.map((block, i) => {
        switch (block.t) {
          case 'p':
            return (
              <AppText key={i} selectable color={ctx.color} muted={ctx.muted}>
                {renderInline(block.c, ctx)}
              </AppText>
            );
          case 'h':
            return (
              <AppText
                key={i}
                selectable
                accessibilityRole="header"
                variant={block.level === 3 ? 'bodyStrong' : 'heading'}
                color={ctx.color}
                muted={ctx.muted}
                style={i > 0 && styles.headingGap}>
                {renderInline(block.c, ctx)}
              </AppText>
            );
          case 'ul':
            return <Items key={i} items={block.items} ctx={ctx} ordered={false} />;
          case 'ol':
            return <Items key={i} items={block.items} ctx={ctx} ordered />;
          case 'code':
            return <CodeBlock key={i} text={block.text} ctx={ctx} />;
          case 'quote':
            return (
              <View key={i} style={styles.quote}>
                <Blocks blocks={block.c} ctx={{ ...ctx, muted: true }} />
              </View>
            );
          case 'table':
            return <Table key={i} head={block.head} rows={block.rows} align={block.align} ctx={ctx} />;
          case 'hr':
            return <View key={i} style={[styles.rule, { backgroundColor: ctx.hairline }]} />;
        }
      })}
    </>
  );
}

export const Markdown = memo(function Markdown({ text, streaming, color }: MarkdownProps) {
  const colors = useColors();
  const { fonts } = useTheme();
  const blocks = useMemo(() => parseMarkdown(text, { streaming }), [text, streaming]);
  const ctx = useMemo<Ctx>(
    () => ({
      color,
      muted: false,
      bold: fonts.bold,
      link: colors.linkText,
      chipBackground: colors.muted,
      chipColor: colors.foreground,
      hairline: colors.hairline,
    }),
    [color, fonts.bold, colors],
  );
  return (
    <View style={styles.root}>
      <Blocks blocks={blocks} ctx={ctx} />
    </View>
  );
});

const styles = StyleSheet.create({
  root: { gap: spacing.sm },
  italic: { fontStyle: 'italic' },
  inlineCode: { fontFamily: monoFont, fontSize: fontSize.sm },
  link: { textDecorationLine: 'underline' },
  headingGap: { marginTop: spacing.xs },
  list: { gap: spacing.xs },
  item: { flexDirection: 'row', alignItems: 'flex-start' },
  marker: { textAlign: 'right', paddingRight: spacing.sm },
  number: { fontVariant: ['tabular-nums'] },
  itemText: { flex: 1 },
  quote: { gap: spacing.sm, paddingLeft: spacing.lg },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: spacing.xs },
  codeScroll: { flexGrow: 0 },
  codeContent: { padding: spacing.sm + 2 },
  tableScroll: { flexGrow: 0 },
  table: { overflow: 'hidden' },
  row: { flexDirection: 'row' },
  cell: { paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.xs + 2, fontSize: fontSize.sm },
  headerCell: { lineHeight: 19 },
});
