import {
  readEvidenceRecords,
  readInspectionFiles,
} from '../data/inspection-access.mjs';
import {
  emptyEvidence,
  mergeEvidence,
  sortByStrings,
} from '../interface/canonical.mjs';
import {
  inferFileRole,
} from './role-inference.mjs';

export function buildSemanticFiles(inspection) {
  const sourceFiles = readInspectionFiles(inspection);
  const records = readEvidenceRecords(inspection);
  const files = sourceFiles.map((file) => {
    const inferred = inferFileRole(file);
    const evidence = mergeEvidence(
      inferred.evidence,
      evidenceForFile(file, records),
    );
    const base = {
      fileId: file.fileId,
      path: file.path,
      role: inferred.role,
      evidence,
    };
    return base;
  });

  return sortByStrings(files, (file) => [file.path, file.fileId]);
}

function evidenceForFile(file, records) {
  const result = emptyEvidence();
  for (const record of records) {
    if (!record.subjects.includes(file.fileId) && !record.subjects.includes(file.path)) {
      continue;
    }
    result[record.state].push(record.key);
  }
  return result;
}
