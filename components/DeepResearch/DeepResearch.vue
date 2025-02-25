<script setup lang="ts">
  import {
    deepResearch,
    type PartialProcessedSearchResult,
    type ResearchStep,
  } from '~/lib/deep-research'
  import {
    feedbackInjectionKey,
    formInjectionKey,
    researchResultInjectionKey,
  } from '~/constants/injection-keys'
  import Flow, { type SearchNode, type SearchEdge } from './SearchFlow.vue'
  import SearchFlow from './SearchFlow.vue'
  import NodeDetail from './NodeDetail.vue'
  import { isChildNode, isParentNode, isRootNode } from '~/utils/tree-node'
  import { UCard, UModal, UButton } from '#components'

  export type DeepResearchNodeStatus = Exclude<ResearchStep['type'], 'complete'>

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
    learnings?: string[]
    status?: DeepResearchNodeStatus
    error?: string
  }

  const emit = defineEmits<{
    (e: 'complete'): void
  }>()

  const toast = useToast()
  const { t, locale } = useI18n()
  const { config } = useConfigStore()
  const isLargeScreen = useMediaQuery('(min-width: 768px)')

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

  // Inject global data from index.vue
  const form = inject(formInjectionKey)!
  const feedback = inject(feedbackInjectionKey)!
  const completeResult = inject(researchResultInjectionKey)!

  function handleResearchProgress(step: ResearchStep) {
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
          node.generateQueriesReasoning =
            (node.generateQueriesReasoning ?? '') + step.delta
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

      case 'processing_serach_result_reasoning': {
        if (node) {
          node.generateLearningsReasoning =
            (node.generateLearningsReasoning ?? '') + step.delta
        }
        break
      }

      case 'processing_serach_result': {
        if (node) {
          node.learnings = step.result.learnings || []
        }
        break
      }

      case 'node_complete': {
        console.log(
          `[DeepResearch] node ${nodeId} processed_search_result:`,
          step,
        )
        if (node && step.result) {
          node.learnings = step.result.learnings
          searchResults.value[nodeId] = step.result
        }
        break
      }

      case 'error':
        console.error(
          `[DeepResearch] node ${nodeId} error:`,
          node,
          step.message,
        )
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
        completeResult.value = {
          learnings: step.learnings,
          visitedUrls: step.visitedUrls,
        }
        emit('complete')
        isLoading.value = false
        break
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
    return {
      id: '0',
      data: { title: 'Start' },
      position: { x: 0, y: 0 },
      type: 'search', // We only have this type
    }
  }

  async function startResearch(retryNode?: DeepResearchNode) {
    if (!form.value.query || !form.value.breadth || !form.value.depth) return

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

    // Wait after the flow is cleared
    await new Promise((r) => requestAnimationFrame(r))

    try {
      let query = getCombinedQuery(form.value, feedback.value)
      let existingLearnings: string[] = []
      let existingVisitedUrls: string[] = []
      let currentDepth = 1
      let breadth = form.value.breadth

      if (retryNode) {
        query = retryNode.label
        // Set the search depth and breadth to its parent's
        if (!isRootNode(retryNode.id)) {
          const parentId = parentNodeId(retryNode.id)!
          currentDepth = nodeDepth(parentId)
          breadth = searchBreadth(breadth, parentId)
        }
        // Collect all parent nodes' learnings and visitedUrls
        const parentNodes = nodes.value.filter((n) =>
          isParentNode(n.id, retryNode.id),
        )
        existingLearnings = parentNodes
          .flatMap((n) => n.learnings || [])
          .filter(Boolean)
        existingVisitedUrls = parentNodes
          .flatMap((n) => n.searchResults || [])
          .map((r) => r.url)
          .filter(Boolean)
      }

      await deepResearch({
        query,
        retryNode,
        currentDepth,
        breadth,
        maxDepth: form.value.depth,
        languageCode: locale.value,
        searchLanguageCode: config.webSearch.searchLanguage,
        learnings: existingLearnings,
        visitedUrls: existingVisitedUrls,
        onProgress: handleResearchProgress,
      })
    } catch (error) {
      console.error('Research failed:', error)
    } finally {
      if (!retryNode) {
        isLoading.value = false
      }
    }
  }

  async function retryNode(nodeId: string) {
    console.log('[DeepResearch] retryNode', nodeId, isLoading.value)
    if (!nodeId || isLoading.value) return

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

    await startResearch(nodeCurrentData)
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
    isLoading,
  })
</script>

<template>
  <UModal v-if="isFullscreen" open fullscreen>
    <template #header>
      <div class="flex items-center justify-between">
        <div>
          <h2 class="font-bold">{{ t('webBrowsing.title') }}</h2>
          <p class="text-sm text-gray-500">
            {{ t('webBrowsing.clickToView') }}
          </p>
        </div>
        <UButton
          icon="i-heroicons-arrows-pointing-out"
          :variant="isFullscreen ? 'solid' : 'ghost'"
          :color="isFullscreen ? 'primary' : 'info'"
          @click="toggleFullscreen"
        />
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
            'border-gray-100 dark:border-gray-800',
            isLargeScreen
              ? 'border-l w-1/3 pl-4 sm:pl-6'
              : 'h-1/2 overflow-y-scroll',
          ]"
        >
          <NodeDetail :node="selectedNode" @retry="retryNode" />
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
        <UButton
          icon="i-heroicons-arrows-pointing-out"
          variant="ghost"
          color="info"
          @click="toggleFullscreen"
        />
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
      <NodeDetail v-if="selectedNode" :node="selectedNode" @retry="retryNode" />
    </div>
  </UCard>
</template>
