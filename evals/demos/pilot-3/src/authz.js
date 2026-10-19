/** Users: { id, role: 'admin' | 'editor' | 'viewer' }. Documents: { id, ownerId }. */
export function canEdit(user, doc) {
  return user.role === 'admin' || user.role === 'editor' || user.id === doc.ownerId;
}

export function canView(user) {
  return ['admin', 'editor', 'viewer'].includes(user.role);
}
