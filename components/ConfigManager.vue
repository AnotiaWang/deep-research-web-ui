<script setup lang="ts">
  interface OpenAICompatibleModel {
    id: string
    object: string
  }
  interface OpenAICompatibleModelsResponse {
    object: string
    data: OpenAICompatibleModel[]
  }

  const {
    config,
    aiApiBase,
    webSearchApiBase,
    showConfigManager: showModal,
  } = storeToRefs(useConfigStore())
  const { t } = useI18n()

  const loadingAiModels = ref(false)
  const aiModelOptions = ref<string[]>([])
  /** If loading AI models failed, use a plain input to improve UX */
  const isLoadAiModelsFailed = ref(false)

  const activeSections = ref(['0', '1'])
  const settingSections = computed(() => [
    {
      label: t('settings.ai.provider'),
      icon: 'i-lucide-bot',
      slot: 'ai',
    },
    {
      label: t('settings.webSearch.provider'),
      icon: 'i-lucide-search',
      slot: 'web-search',
    },
  ])
  const aiProviderOptions = computed(() => [
    {
      label: t('settings.ai.providers.openaiCompatible.title'),
      help: 'settings.ai.providers.openaiCompatible.description',
      // Only kept for easy reference in i18n Ally
      _help: t('settings.ai.providers.openaiCompatible.description'),
      value: 'openai-compatible',
    },
    {
      label: t('settings.ai.providers.siliconflow.title'),
      help: 'settings.ai.providers.siliconflow.description',
      // Only kept for easy reference in i18n Ally
      _help: t('settings.ai.providers.siliconflow.description'),
      value: 'siliconflow',
      link: 'https://cloud.siliconflow.cn/i/J0NHrrX8',
      linkText: 'cloud.siliconflow.cn',
    },
    {
      label: 'DeepSeek',
      value: 'deepseek',
    },
    {
      label: 'OpenRouter',
      value: 'openrouter',
    },
    {
      label: 'Ollama',
      value: 'ollama',
    },
  ])
  const webSearchProviderOptions = computed(() => [
    {
      label: 'Tavily',
      value: 'tavily',
      help: 'settings.webSearch.providers.tavily.help',
      // Only kept for easy reference in i18n Ally
      _help: t('settings.webSearch.providers.tavily.help'),
      link: 'https://app.tavily.com/home',
    },
    {
      label: 'Firecrawl',
      value: 'firecrawl',
      help: 'settings.webSearch.providers.firecrawl.help',
      // Only kept for easy reference in i18n Ally
      _help: t('settings.webSearch.providers.firecrawl.help'),
      link: 'https://www.firecrawl.dev/app/api-keys',
      supportsCustomApiBase: true,
    },
  ])
  const tavilySearchTopicOptions = ['general', 'news', 'finance']
  const selectedAiProvider = computed(() =>
    aiProviderOptions.value.find((o) => o.value === config.value.ai.provider),
  )
  const selectedWebSearchProvider = computed(() =>
    webSearchProviderOptions.value.find(
      (o) => o.value === config.value.webSearch.provider,
    ),
  )

  // Try to find available AI models based on selected provider
  const debouncedListAiModels = useDebounceFn(async () => {
    if (!config.value.ai.apiKey) return
    if (!aiApiBase.value || !aiApiBase.value.startsWith('http')) return

    try {
      loadingAiModels.value = true
      const result: OpenAICompatibleModelsResponse = await $fetch(
        `${aiApiBase.value}/models`,
        {
          headers: {
            Authorization: `Bearer ${config.value.ai.apiKey}`,
          },
        },
      )
      console.log(
        `Found ${result.data.length} AI models for provider ${config.value.ai.provider}`,
      )
      aiModelOptions.value = result.data.map((m) => m.id)
      isLoadAiModelsFailed.value = false

      if (aiModelOptions.value.length) {
        // Auto-select the current model
        if (
          config.value.ai.model &&
          !aiModelOptions.value.includes(config.value.ai.model)
        ) {
          aiModelOptions.value.unshift(config.value.ai.model)
        }
      }
    } catch (error) {
      console.error(`Fetch AI models failed`, error)
      isLoadAiModelsFailed.value = true
      aiModelOptions.value = []
    } finally {
      loadingAiModels.value = false
    }
  }, 500)

  function createAndSelectAiModel(model: string) {
    aiModelOptions.value.push(model)
    config.value.ai.model = model
  }

  // Automatically fetch AI models list
  watch(
    () => [
      config.value.ai.provider,
      config.value.ai.apiKey,
      config.value.ai.apiBase,
      showModal.value,
    ],
    () => {
      if (!showModal.value) return
      debouncedListAiModels()
    },
    { immediate: true },
  )
  // Reset AI config when provider changed
  watch(
    () => config.value.ai.provider,
    () => {
      config.value.ai.apiKey = ''
      config.value.ai.apiBase = ''
      config.value.ai.model = ''
      config.value.ai.contextSize = undefined
    },
  )
  // Reset web search config when provider changed
  watch(
    () => config.value.webSearch.provider,
    () => {
      config.value.webSearch.apiKey = ''
      config.value.webSearch.apiBase = ''
    },
  )

  defineExpose({
    show() {
      showModal.value = true
    },
  })
</script>

<template>
  <div>
    <UModal v-model:open="showModal" :title="$t('settings.title')">
      <UButton icon="i-lucide-settings" />

      <template #body>
        <UAccordion
          v-model="activeSections"
          type="multiple"
          :items="settingSections"
          collapsible
        >
          <!-- AI provider -->
          <template #ai>
            <div class="flex flex-col gap-y-2 mb-2">
              <UFormField>
                <template v-if="selectedAiProvider?.help" #help>
                  <i18n-t
                    class="whitespace-pre-wrap"
                    :keypath="selectedAiProvider.help"
                    tag="span"
                  >
                    <UButton
                      v-if="selectedAiProvider.link"
                      class="!p-0"
                      :to="selectedAiProvider.link"
                      target="_blank"
                      variant="link"
                    >
                      {{
                        selectedAiProvider.linkText || selectedAiProvider.link
                      }}
                    </UButton>
                  </i18n-t>
                </template>
                <USelect
                  v-model="config.ai.provider"
                  class="w-full"
                  :items="aiProviderOptions"
                />
              </UFormField>
              <UFormField
                :label="$t('settings.ai.apiKey')"
                :required="config.ai.provider !== 'ollama'"
              >
                <PasswordInput
                  v-model="config.ai.apiKey"
                  class="w-full"
                  :placeholder="$t('settings.ai.apiKey')"
                />
              </UFormField>
              <UFormField :label="$t('settings.ai.apiBase')">
                <UInput
                  v-model="config.ai.apiBase"
                  class="w-full"
                  :placeholder="aiApiBase"
                />
              </UFormField>
              <UFormField :label="$t('settings.ai.model')" required>
                <UInputMenu
                  v-if="aiModelOptions.length && !isLoadAiModelsFailed"
                  v-model="config.ai.model"
                  class="w-full"
                  :items="aiModelOptions"
                  :placeholder="$t('settings.ai.model')"
                  :loading="loadingAiModels"
                  create-item
                  @create="createAndSelectAiModel"
                />
                <UInput
                  v-else
                  v-model="config.ai.model"
                  class="w-full"
                  :placeholder="$t('settings.ai.model')"
                />
              </UFormField>
              <UFormField :label="$t('settings.ai.contextSize')">
                <template #help>
                  {{ $t('settings.ai.contextSizeHelp') }}
                </template>
                <UInput
                  v-model="config.ai.contextSize"
                  class="w-26"
                  type="number"
                  placeholder="128000"
                  :min="512"
                />
                tokens
              </UFormField>
            </div>
          </template>

          <!-- Web search -->
          <template #web-search>
            <div class="flex flex-col gap-y-2">
              <UFormField>
                <template #help>
                  <i18n-t
                    v-if="selectedWebSearchProvider?.help"
                    :keypath="selectedWebSearchProvider.help"
                    tag="p"
                  >
                    <UButton
                      class="!p-0"
                      :to="selectedWebSearchProvider.link"
                      target="_blank"
                      variant="link"
                    >
                      {{ selectedWebSearchProvider.link }}
                    </UButton>
                  </i18n-t>
                </template>
                <USelect
                  v-model="config.webSearch.provider"
                  class="w-30"
                  :items="webSearchProviderOptions"
                />
              </UFormField>
              <UFormField
                :label="$t('settings.webSearch.apiKey')"
                :required="!config.webSearch.apiBase"
              >
                <PasswordInput
                  v-model="config.webSearch.apiKey"
                  class="w-full"
                  :placeholder="$t('settings.webSearch.apiKey')"
                />
              </UFormField>
              <UFormField
                v-if="selectedWebSearchProvider?.supportsCustomApiBase"
                :label="$t('settings.webSearch.apiBase')"
              >
                <UInput
                  v-model="config.webSearch.apiBase"
                  class="w-full"
                  :placeholder="webSearchApiBase"
                />
              </UFormField>
              <UFormField :label="$t('settings.webSearch.queryLanguage')">
                <template #help>
                  <i18n-t
                    class="whitespace-pre-wrap"
                    keypath="settings.webSearch.queryLanguageHelp"
                    tag="p"
                  />
                </template>
                <LangSwitcher
                  :value="config.webSearch.searchLanguage"
                  @update="config.webSearch.searchLanguage = $event"
                  private
                />
              </UFormField>
              <UFormField :label="$t('settings.webSearch.concurrencyLimit')">
                <template #help>
                  {{ $t('settings.webSearch.concurrencyLimitHelp') }}
                </template>
                <UInput
                  v-model="config.webSearch.concurrencyLimit"
                  class="w-15"
                  type="number"
                  placeholder="2"
                  :min="1"
                  :max="5"
                  :step="1"
                />
              </UFormField>

              <!-- Tavily-specific settings -->
              <template v-if="config.webSearch.provider === 'tavily'">
                <UFormField
                  :label="
                    $t('settings.webSearch.providers.tavily.advancedSearch')
                  "
                  :help="
                    $t('settings.webSearch.providers.tavily.advancedSearchHelp')
                  "
                >
                  <USwitch v-model="config.webSearch.tavilyAdvancedSearch" />
                </UFormField>
                <UFormField
                  :label="$t('settings.webSearch.providers.tavily.searchTopic')"
                  :help="
                    $t('settings.webSearch.providers.tavily.searchTopicHelp')
                  "
                >
                  <USelect
                    v-model="config.webSearch.tavilySearchTopic"
                    class="w-30"
                    :items="tavilySearchTopicOptions"
                    placeholder="general"
                  />
                </UFormField>
              </template>
            </div>
          </template>
        </UAccordion>
      </template>

      <template #footer>
        <div class="flex items-center justify-between gap-2 w-full">
          <p class="text-sm text-gray-500">
            {{ $t('settings.disclaimer') }}
          </p>
          <UButton
            color="primary"
            icon="i-lucide-check"
            @click="showModal = false"
          >
            {{ $t('settings.save') }}
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
