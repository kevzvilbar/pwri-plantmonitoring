// Pages
export { default as ImportPage } from './pages/ImportPage';
export { default as DataCorrectionsPage } from './pages/DataCorrectionsPage';
export { default as DataAnalysisPage } from './pages/DataAnalysisPage';

// Components
export { default as SmartImportPanel } from './components/SmartImportPanel';
export { ImportReadingsDialog, type ImportDialogProps } from './components/ReadingImportDialog';
export {
  parseCSVLine,
  parseCSVText,
  triggerTemplateDownload,
  normalizeDatetime,
  computeIntraFileDuplicateIndices,
  clearDupDecisions,
  clearBulkDupDecision,
  setBulkDupDecision,
  resolveDupPrompt,
  resolveImportDuplicate,
  setDupShowPrompt,
  clearDupShowPrompt,
  logReadingImport,
} from './components/ReadingImportDialog/utils';

export { ReadingHistoryDialog } from './components/ReadingHistoryDialog';
export { getGridMeterVal } from './components/readingHistory/types';
export { CsvImportDialog } from './components/import';
export * from './components/readingHistory/replacementTypes';
export { ReplPill } from './components/readingHistory/ReplPill';
export { MeterReplacementDetailDialog } from './components/readingHistory/MeterReplacementDetailDialog';
export { useMeterReplacementDetail } from './components/readingHistory/useMeterReplacementDetail';
export { replacementToInitial } from './components/readingHistory/replacementEdit';

// Hooks
export * from './hooks/useCorrections';
export { useReadingGaps, gapDescription, type ReadingGap } from './hooks/useReadingGaps';
