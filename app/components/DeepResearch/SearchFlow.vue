<script setup lang="ts">
  import '@vue-flow/core/dist/style.css'
  import '@vue-flow/core/dist/theme-default.css'
  import '@vue-flow/controls/dist/style.css'
  import SearchNode from './SearchNode.vue'
  import {
    type Edge,
    type FlowEvents,
    type Node,
    VueFlow,
    useVueFlow,
    getNodesInside,
  } from '@vue-flow/core'
  import { Background } from '@vue-flow/background'
  import { ControlButton, Controls } from '@vue-flow/controls'
  import type { DeepResearchNodeStatus } from './DeepResearch.vue'
  import {
    createFlowEdge,
    createFlowNode,
    removeDescendantFlowElements,
  } from '~/utils/research-graph'

  export interface SearchNodeData {
    title: string
    status?: DeepResearchNodeStatus
  }
  export type SearchNode = Node<SearchNodeData>
  export type SearchEdge = Edge<SearchNodeData>

  const emit = defineEmits<{
    (e: 'node-click', nodeId: string): void
  }>()

  const props = defineProps<{
    selectedNodeId?: string
    fullscreen?: boolean
  }>()

  const nodes = defineModel<SearchNode[]>('nodes', { required: true })
  const edges = defineModel<SearchEdge[]>('edges', { required: true })

  const { t } = useI18n()
  const isLargeScreen = useMediaQuery('(min-width: 768px)')
  const {
    addNodes: addFlowNodes,
    addEdges: addFlowEdges,
    updateNodeData: updateFlowNodeData,
    fitView,
    viewport,
    vueFlowRef,
    zoomIn,
    zoomOut,
    setInteractive,
    nodesDraggable,
    nodesConnectable,
    elementsSelectable,
    minZoom,
    maxZoom,
  } = useVueFlow()
  const { layout } = useNodeLayout()

  let hasUserInteraction = false
  const minZoomReached = computed(() => viewport.value.zoom <= minZoom.value)
  const maxZoomReached = computed(() => viewport.value.zoom >= maxZoom.value)
  const isInteractive = computed(
    () => nodesDraggable.value || nodesConnectable.value || elementsSelectable.value,
  )

  function fitGraph() {
    hasUserInteraction = false
    fitView({ maxZoom: 1.4 })
  }

  function toggleInteraction() {
    setInteractive(!isInteractive.value)
  }

  function handleNodeClick(nodeId: string) {
    emit('node-click', nodeId)
  }

  function layoutGraph(force = false) {
    nodes.value = layout(nodes.value, edges.value)
    if (!hasUserInteraction || force) {
      // Wait a bit for the viewport to update after resize
      setTimeout(() => {
        // If a node is selected and is outside the viewport, move it to the viewport
        if (props.selectedNodeId) {
          const rect = vueFlowRef.value?.getBoundingClientRect()
          if (!rect) return

          const nodesInViewport = getNodesInside(
            // @ts-ignore
            nodes.value,
            rect,
            viewport.value,
          )

          if (!nodesInViewport.some((n) => n.id === props.selectedNodeId)) {
            fitView({ nodes: [props.selectedNodeId], maxZoom: 1.3 })
          }
        } else {
          fitView({ maxZoom: 1.4 })
        }
      }, 10)
    }
  }

  function addNode(nodeId: string, data: SearchNodeData, parentId?: string) {
    addFlowNodes(createFlowNode(nodeId, data))

    if (parentId) {
      addFlowEdges(createFlowEdge(parentId, nodeId))
    }

    layoutGraph()
  }

  function updateNode(nodeId: string, data: Partial<SearchNodeData>) {
    updateFlowNodeData(nodeId, data)
    layoutGraph()
  }

  function reset() {
    layoutGraph()
    hasUserInteraction = false
  }

  function removeChildNodes(parentId: string) {
    const next = removeDescendantFlowElements(nodes.value, edges.value, parentId)
    nodes.value = next.nodes
    edges.value = next.edges
  }

  function handleDrag(e: PointerEvent | FlowEvents['move']) {
    // Triggered by VueFlow internal logic
    if ('event' in e && !e.event.sourceEvent) {
      return
    }

    hasUserInteraction = true
  }

  defineExpose({
    addNode,
    updateNode,
    reset,
    removeChildNodes,
    layoutGraph,
  })
</script>

<template>
  <ClientOnly fallback-tag="span" fallback="Loading graph...">
    <div :class="[fullscreen ? 'h-full' : isLargeScreen ? 'h-100' : 'h-60']">
      <VueFlow
        v-model:nodes="nodes"
        v-model:edges="edges"
        :edges-updatable="false"
        :min-zoom="0.5"
        :max-zoom="isLargeScreen ? 2.5 : 1.8"
        :default-edge-options="{ animated: true }"
        @nodes-initialized="layoutGraph"
        @move="handleDrag"
      >
        <template #node-search="props">
          <SearchNode
            :data="props.data"
            :selected="selectedNodeId === props.id"
            @click="handleNodeClick(props.id)"
            @pointerdown="handleDrag"
          />
        </template>
        <Background />
        <Controls :show-zoom="false" :show-fit-view="false" :show-interactive="false">
          <ControlButton
            :aria-label="t('graphControls.zoomIn')"
            :title="t('graphControls.zoomIn')"
            :disabled="maxZoomReached"
            @click="zoomIn()"
          >
            <UIcon class="size-3" name="i-lucide-plus" />
          </ControlButton>
          <ControlButton
            :aria-label="t('graphControls.zoomOut')"
            :title="t('graphControls.zoomOut')"
            :disabled="minZoomReached"
            @click="zoomOut()"
          >
            <UIcon class="size-3" name="i-lucide-minus" />
          </ControlButton>
          <ControlButton
            :aria-label="t('graphControls.fitView')"
            :title="t('graphControls.fitView')"
            @click="fitGraph"
          >
            <UIcon class="size-3" name="i-lucide-scan" />
          </ControlButton>
          <ControlButton
            :aria-label="
              isInteractive ? t('graphControls.lockView') : t('graphControls.unlockView')
            "
            :title="isInteractive ? t('graphControls.lockView') : t('graphControls.unlockView')"
            @click="toggleInteraction"
          >
            <UIcon class="size-3" :name="isInteractive ? 'i-lucide-lock-open' : 'i-lucide-lock'" />
          </ControlButton>
        </Controls>
      </VueFlow>
    </div>
  </ClientOnly>
</template>
