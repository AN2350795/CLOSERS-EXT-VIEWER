// API dates are Unix milliseconds; display a consistent Korean calendar date.
globalThis.ResourceDates = {
  label(value) {
    if (value == null || !Number.isFinite(value)) return '원본 수정일 미상';
    const date = new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
    return '원본 수정일 '+date;
  },
  compare(a, b, order) {
    if (a == null || b == null) return (a == null ? 1 : 0) - (b == null ? 1 : 0);
    return order === 'newest' ? b-a : a-b;
  }
};
