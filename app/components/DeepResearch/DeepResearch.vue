<script setup lang="ts">
  import {
    deepResearch,
    type PartialProcessedSearchResult,
    type ProcessedSearchResult,
    type ResearchStep,
  } from '~~/lib/core/deep-research'
  import Flow, { type SearchNode, type SearchEdge } from './SearchFlow.vue'
  import SearchFlow from './SearchFlow.vue'
  import NodeDetail from './NodeDetail.vue'
  import { isChildNode, isParentNode, isRootNode } from '~/utils/tree-node'
  import { UCard, UModal, UButton } from '#components'
  import { useServerMode } from '~/composables/useServerMode'
  import { collectResearchResult } from '~/utils/research-result'
  import { resolveResearchRetryQuery } from '~/utils/research-retry'
  import { createFlowNode } from '~/utils/research-graph'
  import {
    createResearchHistoryGraph,
    restoreResearchHistoryGraph,
  } from '~/utils/research-history-graph'
  import { abortable } from '~~/shared/utils/abort'
  import type { ResearchHistoryGraph, ResearchHistoryNodeStatus } from '~/types/history'
  import type {
    ResearchFeedbackSnapshot,
    ResearchInputSnapshot,
    ResearchResult,
  } from '~~/shared/types/research-session'

  export type DeepResearchNodeStatus = ResearchHistoryNodeStatus

  export type DeepResearchNode = {
    id: string
    /** Label, represents the search query. Generated from parent node. */
    label: string
    /** The research goal of this node. Generated from parent node. */
    researchGoal?: string
    /** Reasoning content when generating queries for the next iteration. */
    generateQueriesReasoning?: string
    /** Reasoning content when generating learnings for this iteration. */
    generateLearningsReasoning?: string
    searchResults?: WebSearchResult[]
    /** Learnings from search results */
    learnings?: ProcessedSearchResult['learnings']
    status?: DeepResearchNodeStatus
    error?: string
  }

  export interface StartResearchOptions {
    input: ResearchInputSnapshot
    feedback: ReadonlyArray<ResearchFeedbackSnapshot>
    isCurrent: () => boolean
    signal?: AbortSignal
  }

  const props = defineProps<{
    disabled?: boolean
  }>()

  const emit = defineEmits<{
    (e: 'retry', nodeId: string): void
  }>()

  const toast = useToast()
  const { t, locale } = useI18n()
  const { config } = useConfigStore()
  const isLargeScreen = useMediaQuery('(min-width: 768px)')
  const { deepResearch: researchFunction } = useServerMode()

  const flowRef = ref<InstanceType<typeof Flow>>()
  const rootNode: DeepResearchNode = { id: '0', label: 'Start' }
  // The complete search data.
  // There's another tree stored in SearchNode.vue, with only basic data (id, status, ...)
  const nodes = ref<DeepResearchNode[]>([{ ...rootNode }])
  const selectedNodeId = ref<string>()
  const searchResults = ref<Record<string, PartialProcessedSearchResult>>({})
  const isLoading = ref(false)
  const isFullscreen = ref(false)
  // The edges and nodes of SearchFlow.vue
  // These are not managed inside SearchFlow, because here we need to switch between
  // two SearchFlows in fullscreen and non-fullscreen mode
  const flowNodes = ref<SearchNode[]>([flowRootNode()])
  const flowEdges = ref<SearchEdge[]>([])

  const selectedNode = computed(() => {
    if (selectedNodeId.value) {
      return nodes.value.find((n) => n.id === selectedNodeId.value)
    }
  })

  function handleResearchProgress(step: ResearchStep): ResearchResult | undefined {
    let node: DeepResearchNode | undefined
    let nodeId = ''

    if (step.type !== 'complete') {
      nodeId = step.nodeId
      node = nodes.value.find((n) => n.id === nodeId)
      if (node && node.status !== step.type) {
        // FIXME: currently `node_complete` is always triggered last,
        // so error is possibly overridden
        if (node.status === 'error') {
          return
        }
        node.status = step.type
        flowRef.value?.updateNode(nodeId, {
          status: step.type,
        })
      }
    }

    switch (step.type) {
      case 'generating_query_reasoning': {
        if (node) {
          node.generateQueriesReasoning = (node.generateQueriesReasoning ?? '') + step.delta
        }
        break
      }

      case 'generating_query': {
        if (!node) {
          node = {
            id: nodeId,
            label: step.result.query ?? '',
            researchGoal: '',
            learnings: [],
          }
          const parentNodeId = step.parentNodeId
          nodes.value.push(node)
          flowRef.value?.addNode(
            nodeId,
            {
              title: node.label,
              status: node.status,
            },
            parentNodeId,
          )
        } else {
          if (node.label !== step.result.query) {
            flowRef.value?.updateNode(nodeId, {
              title: step.result.query ?? '',
            })
          }
        }
        // Update the node
        if (!isRootNode(node.id)) {
          node.label = step.result.query ?? ''
          node.researchGoal = step.result.researchGoal
        }
        break
      }

      case 'generated_query': {
        console.log(`[DeepResearch] node ${nodeId} generated query:`, step)
        break
      }

      case 'searching': {
        console.log(`[DeepResearch] node ${nodeId} searching:`, step)
        break
      }

      case 'search_complete': {
        console.log(`[DeepResearch] node ${nodeId} search complete:`, step)
        if (node) {
          node.searchResults = step.results
        }
        break
      }

      case 'processing_search_result_reasoning': {
        if (node) {
          node.generateLearningsReasoning = (node.generateLearningsReasoning ?? '') + step.delta
        }
        break
      }

      case 'processing_search_result': {
        if (node) {
          node.learnings = step.result.learnings || []
        }
        break
      }

      case 'node_complete': {
        console.log(`[DeepResearch] node ${nodeId} processed_search_result:`, step)
        if (node && step.result) {
          node.learnings = step.result.learnings
          searchResults.value[nodeId] = step.result
        }
        break
      }

      case 'error':
        console.error(`[DeepResearch] node ${nodeId} error:`, node, step.message)
        node!.error = step.message
        toast.add({
          title: t('webBrowsing.nodeFailedToast', {
            label: node!.label ?? nodeId,
          }),
          description: step.message,
          color: 'error',
          duration: 8000,
        })
        break

      case 'complete':
        console.log(`[DeepResearch] complete:`, step)
        const result = {
          learnings: step.learnings,
        }
        isLoading.value = false
        return result
    }
  }

  function selectNode(nodeId: string) {
    if (selectedNodeId.value === nodeId) {
      selectedNodeId.value = undefined
    } else {
      selectedNodeId.value = nodeId
      flowRef.value?.layoutGraph(true)
    }
  }

  // The default root node for SearchFlow
  function flowRootNode(): SearchNode {
    return createFlowNode('0', { title: 'Start' })
  }

  interface ResearchGraphSnapshot {
    nodes: DeepResearchNode[]
    selectedNodeId: string | undefined
    searchResults: Record<string, PartialProcessedSearchResult>
    flowNodes: SearchNode[]
    flowEdges: SearchEdge[]
  }

  function snapshotResearchGraph(): ResearchGraphSnapshot {
    return structuredClone({
      nodes: toRaw(nodes.value),
      selectedNodeId: selectedNodeId.value,
      searchResults: toRaw(searchResults.value),
      flowNodes: toRaw(flowNodes.value),
      flowEdges: toRaw(flowEdges.value),
    })
  }

  function restoreResearchGraph(snapshot: ResearchGraphSnapshot) {
    nodes.value = snapshot.nodes
    selectedNodeId.value = snapshot.selectedNodeId
    searchResults.value = snapshot.searchResults
    flowNodes.value = snapshot.flowNodes
    flowEdges.value = snapshot.flowEdges
    nextTick(() => flowRef.value?.reset())
  }

  let activeResearch = 0

  async function startResearch(options: StartResearchOptions, retryNode?: DeepResearchNode) {
    const { input, feedback: feedbackSnapshot } = options
    if (!input.query || !input.breadth || !input.depth) return
    const researchId = ++activeResearch
    const isCurrent = options.isCurrent
    let result: ResearchResult | undefined

    // Clear all nodes if it's not a retry
    if (!retryNode) {
      nodes.value = [{ ...rootNode }]
      selectedNodeId.value = undefined
      searchResults.value = {}
      flowNodes.value = [flowRootNode()]
      flowEdges.value = []
      isLoading.value = true
      // Wait for the nodes and edges to reflect to `SearchFlow.vue`
      nextTick(() => {
        flowRef.value?.reset()
      })
    }

    try {
      // Wait after the flow is cleared
      await abortable(new Promise((resolve) => requestAnimationFrame(resolve)), options.signal)

      let query = getCombinedQuery(input, [...feedbackSnapshot])
      let existingLearnings: ProcessedSearchResult['learnings'] = []
      let currentDepth = 1
      let breadth = input.breadth

      if (retryNode) {
        query = resolveResearchRetryQuery(query, retryNode)
        // Set the search depth and breadth to its parent's
        if (!isRootNode(retryNode.id)) {
          const parentId = parentNodeId(retryNode.id)!
          currentDepth = nodeDepth(parentId)
          breadth = searchBreadth(breadth, parentId)
        }
        // Collect all parent nodes' learnings and visitedUrls
        const parentNodes = nodes.value.filter((n) => isParentNode(n.id, retryNode.id))
        existingLearnings = parentNodes.flatMap((n) => n.learnings || []).filter(Boolean)
      }

      await researchFunction({
        query,
        retryNode,
        currentDepth,
        breadth,
        aiConfig: config.ai,
        maxDepth: input.depth,
        languageCode: locale.value,
        searchLanguageCode: config.webSearch.searchLanguage,
        learnings: existingLearnings,
        signal: options.signal,
        onProgress: (step) => {
          if (!isCurrent()) return
          result = handleResearchProgress(step) ?? result
        },
      })
      if (!isCurrent()) return
      if (retryNode) {
        if (retryNode.id !== '0' && !searchResults.value[retryNode.id]?.learnings?.length) {
          return
        }

        return collectResearchResult(Object.values(searchResults.value))
      }
      return result
    } catch (error) {
      if (!isCurrent()) return
      console.error('Research failed:', error)
      if (options) throw error
    } finally {
      if (!retryNode && researchId === activeResearch) {
        isLoading.value = false
      }
    }
  }

  async function retryNode(nodeId: string, options: StartResearchOptions) {
    console.log('[DeepResearch] retryNode', nodeId, isLoading.value)
    if (!nodeId || isLoading.value) return

    const graphSnapshot = snapshotResearchGraph()

    // Remove all child nodes first
    nodes.value = nodes.value.filter((n) => !isChildNode(nodeId, n.id))
    flowRef.value?.removeChildNodes(nodeId)

    const node = nodes.value.find((n) => n.id === nodeId)
    // Take a clone of the node
    // Used in `deepResearch()` to access the node's original query and searchGoal
    let nodeCurrentData: DeepResearchNode | undefined

    if (node) {
      nodeCurrentData = { ...node }
      node.status = undefined
      node.error = undefined
      node.searchResults = undefined
      node.learnings = undefined
      node.generateLearningsReasoning = undefined
      node.generateQueriesReasoning = undefined

      // Remove related search results
      delete searchResults.value[nodeId]
      Object.keys(searchResults.value).forEach((key) => {
        if (isChildNode(nodeId, key)) {
          delete searchResults.value[key]
        }
      })
    }

    try {
      const result = await startResearch(options, nodeCurrentData)
      if (!result?.learnings.length) restoreResearchGraph(graphSnapshot)
      return result
    } catch (error) {
      restoreResearchGraph(graphSnapshot)
      throw error
    }
  }

  function clear() {
    activeResearch += 1
    nodes.value = [{ ...rootNode }]
    selectedNodeId.value = undefined
    searchResults.value = {}
    flowNodes.value = [flowRootNode()]
    flowEdges.value = []
    isLoading.value = false
    nextTick(() => flowRef.value?.reset())
  }

  function exportGraph(): ResearchHistoryGraph {
    return createResearchHistoryGraph(nodes.value, selectedNodeId.value)
  }

  function importGraph(graph?: ResearchHistoryGraph) {
    activeResearch += 1
    isLoading.value = false
    isFullscreen.value = false

    if (!graph?.nodes?.length) {
      nodes.value = [{ ...rootNode }]
      selectedNodeId.value = undefined
      searchResults.value = {}
      flowNodes.value = [flowRootNode()]
      flowEdges.value = []
      nextTick(() => flowRef.value?.reset())
      return
    }

    const restored = restoreResearchHistoryGraph(graph)
    nodes.value = restored.nodes
    selectedNodeId.value = restored.selectedNodeId
    searchResults.value = restored.searchResults
    flowNodes.value = restored.flowNodes
    flowEdges.value = restored.flowEdges
    nextTick(() => flowRef.value?.reset())
  }

  let scrollY = 0

  function toggleFullscreen() {
    // Because changing `isFullscreen` causes the height of the page to change (UCard disappears and appears)
    // so we should scroll back to the last position after exiting fullscreen mode.
    if (!isFullscreen.value) {
      scrollY = window.scrollY
    } else {
      requestAnimationFrame(() => {
        window.scrollTo({ top: scrollY })
      })
    }
    isFullscreen.value = !isFullscreen.value
  }

  defineExpose({
    startResearch,
    retryNode,
    clear,
    exportGraph,
    importGraph,
    isLoading,
  })
</script>

<template>
  <UModal v-if="isFullscreen" open fullscreen :ui="{ body: '!pr-0' }">
    <template #header>
      <div class="w-full flex items-center justify-between">
        <div>
          <h2 class="font-bold">{{ t('webBrowsing.title') }}</h2>
          <p class="text-sm text-gray-500">
            {{ t('webBrowsing.clickToView') }}
          </p>
        </div>
        <UTooltip :text="t('exitFullscreen')" :delay-duration="100">
          <UButton
            icon="i-material-symbols:fullscreen-exit"
            variant="ghost"
            color="info"
            :aria-label="t('exitFullscreen')"
            @click="toggleFullscreen"
          />
        </UTooltip>
      </div>
    </template>

    <template #body>
      <div :class="['flex h-full', !isLargeScreen && 'flex-col']">
        <div class="flex-1">
          <SearchFlow
            ref="flowRef"
            v-model:nodes="flowNodes"
            v-model:edges="flowEdges"
            :selected-node-id="selectedNodeId"
            fullscreen
            @node-click="selectNode"
          />
        </div>
        <div
          v-if="selectedNode"
          :class="[
            'border-gray-100 dark:border-gray-800 px-4 sm:px-6 overflow-y-auto',
            isLargeScreen ? 'border-l w-1/3' : 'h-1/2 pt-2',
          ]"
        >
          <NodeDetail
            :node="selectedNode"
            :disabled="props.disabled"
            @retry="emit('retry', $event)"
          />
        </div>
      </div>
    </template>
  </UModal>

  <UCard v-if="!isFullscreen">
    <template #header>
      <div class="flex items-center justify-between">
        <div>
          <h2 class="font-bold">{{ t('webBrowsing.title') }}</h2>
          <p class="text-sm text-gray-500">
            {{ t('webBrowsing.description') }}
            <br />
            {{ t('webBrowsing.clickToView') }}
          </p>
        </div>
        <UTooltip :text="t('fullscreen')" :delay-duration="100">
          <UButton
            icon="i-material-symbols:fullscreen"
            variant="ghost"
            color="info"
            :aria-label="t('fullscreen')"
            @click="toggleFullscreen"
          />
        </UTooltip>
      </div>
    </template>
    <div class="flex flex-col">
      <SearchFlow
        ref="flowRef"
        v-model:nodes="flowNodes"
        v-model:edges="flowEdges"
        :selected-node-id="selectedNodeId"
        @node-click="selectNode"
      />
      <NodeDetail
        v-if="selectedNode"
        :node="selectedNode"
        :disabled="props.disabled"
        @retry="emit('retry', $event)"
      />
    </div>
  </UCard>
</template>
