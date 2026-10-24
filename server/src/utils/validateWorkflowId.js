export function isValidWorkflowId(id) {
  return /^[1-9]\d*$/.test(id);
}
