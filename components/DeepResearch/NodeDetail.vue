<script setup lang="ts">
  import { marked } from 'marked'

  import type { DeepResearchNode } from './DeepResearch.vue'

  defineProps<{
    node: DeepResearchNode
  }>()

  defineEmits<{
    (e: 'retry', nodeId: string): void
  }>()
</script>

<template>
  <div>
    <USeparator :label="$t('webBrowsing.nodeDetails')" />
    <UAlert
      v-if="node.error"
      class="my-2"
      :title="$t('webBrowsing.nodeFailed')"
      :description="node.error"
      color="error"
      variant="soft"
      :actions="[
        {
          label: $t('webBrowsing.retry'),
          color: 'secondary',
          onClick: () => $emit('retry', node.id),
        },
      ]"
    />
    <h2 class="text-xl font-bold my-2">
      {{ node.label ?? $t('webBrowsing.generating') }}
    </h2>

    <!-- Research goal -->
    <h3 class="text-lg font-semibold mt-2">
      {{ $t('webBrowsing.researchGoal') }}
    </h3>
    <!-- Root node has no additional information -->
    <p v-if="isRootNode(node.id)">
      {{ $t('webBrowsing.startNode.description') }}
    </p>
    <p
      v-if="node.researchGoal"
      class="prose max-w-none dark:prose-invert"
      v-html="marked(node.researchGoal, { gfm: true })"
    />

    <!-- Visited URLs -->
    <h3 class="text-lg font-semibold mt-2">
      {{ $t('webBrowsing.visitedUrls') }}
    </h3>
    <ul v-if="node.searchResults?.length" class="list-disc list-inside">
      <li
        v-for="(item, index) in node.searchResults"
        class="whitespace-pre-wrap break-all"
        :key="index"
      >
        <UButton
          class="!p-0 contents"
          variant="link"
          :href="item.url"
          target="_blank"
        >
          {{ item.title || item.url }}
        </UButton>
      </li>
    </ul>
    <span v-else> - </span>

    <!-- Learnings -->
    <h3 class="text-lg font-semibold mt-2">
      {{ $t('webBrowsing.learnings') }}
    </h3>

    <ReasoningAccordion
      v-if="node.generateLearningsReasoning"
      v-model="node.generateLearningsReasoning"
      class="my-2"
      :loading="
        node.status === 'processing_serach_result_reasoning' ||
        node.status === 'processing_serach_result'
      "
    />
    <p
      v-for="(learning, index) in node.learnings"
      class="prose max-w-none dark:prose-invert"
      :key="index"
      v-html="marked(`- ${learning}`, { gfm: true })"
    />
    <span v-if="!node.learnings?.length"> - </span>

    <!-- Follow up questions -->
    <!-- Only show if there is reasoning content. Otherwise the follow-ups are basically just child nodes. -->
    <template v-if="node.generateQueriesReasoning">
      <h3 class="text-lg font-semibold my-2">
        {{ $t('webBrowsing.followUpQuestions') }}
      </h3>

      <!-- Set loading default to true, because currently don't know how to handle it otherwise -->
      <ReasoningAccordion
        v-if="node.generateQueriesReasoning"
        v-model="node.generateQueriesReasoning"
        :loading="
          node.status === 'generating_query_reasoning' ||
          node.status === 'generating_query'
        "
      />
    </template>
  </div>
</template>
