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
  applyAnnotation,
  readAnnotations,
} from './annotation-normalization.mjs';
import {
  inferFileRole,
} from './role-inference.mjs';

export function buildSemanticFiles(inspection, rawAnnotations) {
  const sourceFiles = uniqueFiles(readInspectionFiles(inspection));
  const records = readEvidenceRecords(inspection);
  const annotations = readAnnotations(rawAnnotations, sourceFiles);
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
    return applyAnnotation(base, annotations);
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

function uniqueFiles(files) {
  const byId = new Map();
  for (const file of files) {
    const existing = byId.get(file.fileId);
    if (existing === undefined || compareFiles(file, existing) < 0) {
      byId.set(file.fileId, file);
    }
  }
  return [...byId.values()];
}

function compareFiles(left, right) {
  const leftKey = `${left.path}\u0000${left.fileId}`;
  const rightKey = `${right.path}\u0000${right.fileId}`;
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}
