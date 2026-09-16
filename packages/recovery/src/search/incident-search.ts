export interface IncidentSearchQuery {
  readonly query: string;
  readonly worldId?: string;
  readonly fromTimestampMs?: number;
  readonly toTimestampMs?: number;
  readonly limit?: number;
}

export interface SearchableIncidentItem {
  readonly id: string;
  readonly worldId: string;
  readonly title: string;
  readonly content: string;
  readonly timestampMs: number;
  readonly category: 'REPORT' | 'AUDIT' | 'SNAPSHOT' | 'INVESTIGATION';
}

export class IncidentSearchEngine {
  /**
   * Filters and ranks searchable items using token-matching relevance scoring.
   */
  static search(
    items: readonly SearchableIncidentItem[],
    query: IncidentSearchQuery,
  ): SearchableIncidentItem[] {
    const rawTokens = query.query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 0);

    const filtered = items.filter((item) => {
      if (query.worldId && item.worldId !== query.worldId) return false;
      if (query.fromTimestampMs && item.timestampMs < query.fromTimestampMs) return false;
      if (query.toTimestampMs && item.timestampMs > query.toTimestampMs) return false;

      if (rawTokens.length === 0) return true;

      const haystack = `${item.title} ${item.content}`.toLowerCase();
      return rawTokens.some((token) => haystack.includes(token));
    });

    // Score relevance based on occurrences in title (weight 3) and content (weight 1)
    const scored = filtered.map((item) => {
      let score = 0;
      const titleLower = item.title.toLowerCase();
      const contentLower = item.content.toLowerCase();

      for (const token of rawTokens) {
        if (titleLower.includes(token)) score += 3;
        if (contentLower.includes(token)) score += 1;
      }
      return { item, score };
    });

    scored.sort((a, b) => b.score - a.score || b.item.timestampMs - a.item.timestampMs);

    const limit = query.limit ?? 50;
    return scored.slice(0, limit).map((s) => s.item);
  }
}
