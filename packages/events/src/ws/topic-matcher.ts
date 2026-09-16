export class TopicMatcher {
  /**
   * Matches a topic pattern containing wildcards (`*`) against a concrete topic string.
   * Examples:
   *  - 'world:*:events' matches 'world:123:events'
   *  - 'world:123:*' matches 'world:123:events' and 'world:123:metrics'
   *  - '*' matches everything
   */
  public static matches(pattern: string, topic: string): boolean {
    if (pattern === '*' || pattern === topic) {
      return true;
    }

    const patternParts = pattern.split(':');
    const topicParts = topic.split(':');

    if (patternParts.length !== topicParts.length) {
      // Check if last pattern part is wildcard that allows multi-suffix
      if (patternParts[patternParts.length - 1] === '*' && topicParts.length >= patternParts.length) {
        for (let i = 0; i < patternParts.length - 1; i++) {
          if (patternParts[i] !== '*' && patternParts[i] !== topicParts[i]) {
            return false;
          }
        }
        return true;
      }
      return false;
    }

    for (let i = 0; i < patternParts.length; i++) {
      const p = patternParts[i];
      const t = topicParts[i];
      if (p !== '*' && p !== t) {
        return false;
      }
    }

    return true;
  }
}
