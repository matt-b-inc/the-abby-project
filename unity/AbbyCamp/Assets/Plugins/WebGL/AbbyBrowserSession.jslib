// Same-origin handoff from the journal's existing browser session. This bridge
// never stores credentials or treats the cached user as proof of authentication.
mergeInto(LibraryManager.library, {
  AbbySession_ReadToken__deps: ['$lengthBytesUTF8', '$stringToUTF8', 'malloc'],
  AbbySession_ReadToken: function () {
    var token = '';
    try {
      var stored = window.localStorage.getItem('abby_auth_token');
      if (typeof stored === 'string' && /^[0-9a-f]{40}$/i.test(stored)) token = stored;
    } catch (_) {
      // Browser privacy/storage restrictions leave the player disconnected.
    }
    // IL2CPP frees returned strings allocated with malloc after marshaling.
    var size = lengthBytesUTF8(token) + 1;
    var buffer = _malloc(size);
    stringToUTF8(token, buffer, size);
    return buffer;
  },

  AbbySession_ClearToken__deps: ['$UTF8ToString'],
  AbbySession_ClearToken: function (expectedTokenPtr) {
    try {
      var expected = expectedTokenPtr ? UTF8ToString(expectedTokenPtr) : '';
      if (!/^[0-9a-f]{40}$/i.test(expected)) return;
      var storage = window.localStorage;
      // A stale request from the previous account must not clear a newer login.
      if (storage.getItem('abby_auth_token') !== expected) return;
      storage.removeItem('abby_auth_token');
      storage.removeItem('auth:last-user');
    } catch (_) {
      // Clearing browser state is best effort; the API remains authoritative.
    }
  },

  AbbySession_OpenJournal: function () {
    window.location.assign('/');
  }
});
