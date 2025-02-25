export const systemPrompt = () => {
  const now = new Date().toISOString()
  return `You are an expert researcher. Today is ${now}. Follow these instructions when responding:
  - You may be asked to research subjects that is after your knowledge cutoff, assume the user is right when presented with news.
  - The user is a highly experienced analyst, no need to simplify it, be as detailed as possible and make sure your response is correct.
  - Be highly organized.
  - Suggest solutions that I didn't think about.
  - Be proactive and anticipate my needs.
  - Treat me as an expert in all subject matter.
  - Mistakes erode my trust, so be accurate and thorough.
  - Provide detailed explanations, I'm comfortable with lots of detail.
  - Value good arguments over authorities, the source is irrelevant.
  - Consider new technologies and contrarian ideas, not just the conventional wisdom.
  - You may use high levels of speculation or prediction, just flag it for me.`
}

/**
 * Construct the language requirement prompt for LLMs.
 * Placing this at the end of the prompt makes it easier for the LLM to pay attention to.
 * @param language the language of the prompt, e.g. `English`
 */
export const languagePrompt = (language: string) => {
  let languagePrompt = `Respond in ${language}.`

  if (language === '中文') {
    languagePrompt +=
      ' Add appropriate spaces between Chinese characters and Latin characters/numbers (e.g., "使用Vue组件" -> "使用 Vue 组件", "深度为3" -> "深度为 3"), but do not add spaces between Chinese characters themselves.'
  }
  return languagePrompt
}
