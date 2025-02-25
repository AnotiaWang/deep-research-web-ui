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
  import { Controls } from '@vue-flow/controls'
  import type { DeepResearchNodeStatus } from './DeepResearch.vue'

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

  const isLargeScreen = useMediaQuery('(min-width: 768px)')
  const {
    addNodes: addFlowNodes,
    addEdges: addFlowEdges,
    updateNodeData: updateFlowNodeData,
    fitView,
    viewport,
    vueFlowRef,
  } = useVueFlow()
  const { layout } = useNodeLayout()

  let hasUserInteraction = false

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
    addFlowNodes({
      id: nodeId,
      data,
      position: { ...{ x: 0, y: 0 } },
      type: 'search',
    })

    if (parentId) {
      addFlowEdges({
        id: `e:${parentId}:${nodeId}`,
        source: parentId,
        target: nodeId,
      })
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

  function isChildNode(parentId: string, childId: string) {
    return childId.length > parentId.length && childId.startsWith(parentId)
  }

  function removeChildNodes(parentId: string) {
    const childNodes = nodes.value.filter((n) => isChildNode(parentId, n.id))
    childNodes.forEach((node) => {
      // 移除节点和相关的边
      nodes.value = nodes.value.filter((n) => n.id !== node.id)
      edges.value = edges.value.filter(
        (e) => e.source !== node.id && e.target !== node.id,
      )
    })
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
        <Controls @fit-view="hasUserInteraction = false" />
      </VueFlow>
    </div>
  </ClientOnly>
</template>
