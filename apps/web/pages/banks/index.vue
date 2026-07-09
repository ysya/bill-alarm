<script setup lang="ts">
import { toast } from 'vue-sonner'
import type { BankPreset } from '@bill-alarm/shared/constants'
import type { BankAccountDTO, BankDTO } from '@bill-alarm/shared/types'

const bankApi = useBankApi()
const bankAccountApi = useBankAccountApi()

const presets = ref<BankPreset[]>([])
const enabledBanks = ref<BankDTO[]>([])
const bankAccounts = ref<BankAccountDTO[]>([])
const loading = ref(true)

// Shared across the password/edit/custom dialogs (see BanksPresetBankSection,
// BanksBankEditDialog, BanksCustomBankSection): the eye-icon "show password"
// toggle is a single piece of state in the original page, so its reveal
// state deliberately carries over between whichever of those dialogs opens
// next. Kept centralized here to preserve that behavior exactly.
const showPassword = ref(false)

// Edit dialog is opened from both the preset and custom bank sections, so
// its open/target state lives here; the dialog owns the rest of its form.
const editDialogOpen = ref(false)
const editingBank = ref<BankDTO | null>(null)

async function fetchData() {
  loading.value = true
  try {
    const [p, e, a] = await Promise.all([bankApi.getPresets(), bankApi.list(), bankAccountApi.list()])
    presets.value = p
    enabledBanks.value = e
    bankAccounts.value = a
  }
  catch (error) {
    toast.error('載入失敗', { description: String(error) })
  }
  finally {
    loading.value = false
  }
}

function openEdit(bank: BankDTO) {
  editingBank.value = bank
  editDialogOpen.value = true
}

onMounted(fetchData)
</script>

<template>
  <div class="space-y-8">
    <div>
      <h1 class="text-2xl font-bold tracking-tight">
        銀行管理
      </h1>
      <p class="text-sm text-muted-foreground mt-1">
        啟用你有帳單的銀行，系統會自動掃描對應的 email。
      </p>
    </div>

    <Separator />

    <BanksPresetBankSection
      v-model:show-password="showPassword"
      :presets="presets"
      :banks="enabledBanks"
      :loading="loading"
      @edit="openEdit"
      @changed="fetchData"
    />

    <Separator />

    <BanksCustomBankSection
      v-model:show-password="showPassword"
      :banks="enabledBanks"
      @edit="openEdit"
      @changed="fetchData"
    />

    <Separator />

    <BanksBankAccountSection
      :accounts="bankAccounts"
      @changed="fetchData"
    />

    <BanksBankEditDialog
      v-model:open="editDialogOpen"
      v-model:show-password="showPassword"
      :editing-bank="editingBank"
      :presets="presets"
      :bank-accounts="bankAccounts"
      @changed="fetchData"
    />
  </div>
</template>
