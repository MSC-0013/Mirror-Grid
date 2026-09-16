import assert from 'node:assert/strict';
import { TopicMatcher } from '../../src/ws/topic-matcher.js';

export async function testTopicMatcher() {
  console.log('Testing TopicMatcher...');

  // Exact matching
  assert.equal(TopicMatcher.matches('world:123:events', 'world:123:events'), true);
  assert.equal(TopicMatcher.matches('world:123:events', 'world:456:events'), false);

  // Single segment wildcard
  assert.equal(TopicMatcher.matches('world:*:events', 'world:123:events'), true);
  assert.equal(TopicMatcher.matches('world:*:events', 'world:xyz:events'), true);
  assert.equal(TopicMatcher.matches('world:*:events', 'world:123:metrics'), false);

  // Suffix wildcard
  assert.equal(TopicMatcher.matches('world:123:*', 'world:123:events'), true);
  assert.equal(TopicMatcher.matches('world:123:*', 'world:123:metrics'), true);
  assert.equal(TopicMatcher.matches('world:123:*', 'world:123:deep:sub'), true);
  assert.equal(TopicMatcher.matches('world:123:*', 'world:456:events'), false);

  // Global wildcard
  assert.equal(TopicMatcher.matches('*', 'world:123:events'), true);
  assert.equal(TopicMatcher.matches('*', 'any:topic:at:all'), true);

  console.log('✓ TopicMatcher tests passed');
}
