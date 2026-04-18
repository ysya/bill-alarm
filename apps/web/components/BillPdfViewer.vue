<script setup lang="ts">
import VuePdfEmbed from 'vue-pdf-embed'
import 'vue-pdf-embed/dist/styles/annotationLayer.css'
import 'vue-pdf-embed/dist/styles/textLayer.css'
import { ChevronLeft, ChevronRight, Loader2, AlertTriangle } from 'lucide-vue-next'

const props = defineProps<{
  source: string
}>()

const page = ref(1)
const pageCount = ref(0)
const loading = ref(true)
const error = ref<string | null>(null)

function onLoaded(doc: any) {
  loading.value = false
  pageCount.value = doc?.numPages ?? 0
}

function onLoadError(e: unknown) {
  loading.value = false
  error.value = (e as Error)?.message ?? 'PDF 載入失敗'
}

function prev() {
  if (page.value > 1) page.value -= 1
}

function next() {
  if (page.value < pageCount.value) page.value += 1
}

watch(() => props.source, () => {
  page.value = 1
  pageCount.value = 0
  loading.value = true
  error.value = null
})
</script>

<template>
  <div class="flex flex-col gap-2">
    <!-- Toolbar -->
    <div class="flex items-center justify-between text-sm">
      <div class="flex items-center gap-1">
        <Button size="icon-sm" variant="ghost" :disabled="page <= 1 || loading" @click="prev">
          <ChevronLeft class="h-4 w-4" />
        </Button>
        <span class="text-muted-foreground tabular-nums">
          {{ pageCount ? `${page} / ${pageCount}` : '—' }}
        </span>
        <Button size="icon-sm" variant="ghost" :disabled="page >= pageCount || loading" @click="next">
          <ChevronRight class="h-4 w-4" />
        </Button>
      </div>
    </div>

    <!-- Viewer -->
    <div class="relative rounded-md border bg-muted overflow-auto max-h-[75vh]">
      <!-- Loading overlay -->
      <div v-if="loading" class="absolute inset-0 flex items-center justify-center text-muted-foreground">
        <Loader2 class="h-6 w-6 animate-spin" />
      </div>

      <!-- Error -->
      <div v-else-if="error" class="flex flex-col items-center justify-center gap-2 p-6 text-destructive">
        <AlertTriangle class="h-6 w-6" />
        <span class="text-sm">{{ error }}</span>
      </div>

      <!-- PDF -->
      <VuePdfEmbed
        v-show="!error"
        :source="source"
        :page="page"
        class="pdf-canvas"
        @loaded="onLoaded"
        @loading-failed="onLoadError"
        @rendering-failed="onLoadError"
      />
    </div>
  </div>
</template>

<style scoped>
.pdf-canvas :deep(canvas) {
  width: 100% !important;
  height: auto !important;
  display: block;
}
</style>
