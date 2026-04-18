<script setup lang="ts">
import VuePdfEmbed from 'vue-pdf-embed'
import 'vue-pdf-embed/dist/styles/annotationLayer.css'
import 'vue-pdf-embed/dist/styles/textLayer.css'
import { Loader2, AlertTriangle } from 'lucide-vue-next'

defineProps<{
  source: string
}>()

const loading = ref(true)
const error = ref<string | null>(null)
const pageCount = ref(0)

function onLoaded(doc: any) {
  loading.value = false
  pageCount.value = doc?.numPages ?? 0
}

function onLoadError(e: unknown) {
  loading.value = false
  error.value = (e as Error)?.message ?? 'PDF 載入失敗'
}
</script>

<template>
  <div class="relative rounded-md border bg-muted overflow-auto max-h-[80vh]">
    <!-- Loading overlay -->
    <div v-if="loading" class="absolute inset-0 flex items-center justify-center text-muted-foreground pointer-events-none">
      <Loader2 class="h-6 w-6 animate-spin" />
    </div>

    <!-- Error -->
    <div v-else-if="error" class="flex flex-col items-center justify-center gap-2 p-6 text-destructive">
      <AlertTriangle class="h-6 w-6" />
      <span class="text-sm">{{ error }}</span>
    </div>

    <!-- All pages, stacked -->
    <VuePdfEmbed
      v-show="!error"
      :source="source"
      class="pdf-canvas"
      @loaded="onLoaded"
      @loading-failed="onLoadError"
      @rendering-failed="onLoadError"
    />
  </div>
</template>

<style scoped>
.pdf-canvas :deep(.vue-pdf-embed__page) {
  margin-bottom: 8px;
}
.pdf-canvas :deep(.vue-pdf-embed__page:last-child) {
  margin-bottom: 0;
}
.pdf-canvas :deep(canvas) {
  width: 100% !important;
  height: auto !important;
  display: block;
}
</style>
