'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { io, Socket } from 'socket.io-client';

// =====================================================================
// WEBSOCKET HOOK - Real-time connection to ERP WebSocket service
// Provides auto-reconnect with exponential backoff + jitter,
// heartbeat/ping-pong, connection state machine, auth, event subscription,
// and online presence
// =====================================================================

// =====================================================================
// Connection State Machine
// =====================================================================

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

interface UseWebSocketOptions {
  userId: string;
  role: string;
  unitId?: string;
  userName?: string;
  authToken?: string;
  enabled?: boolean;
}

interface UseWebSocketReturn {
  socket: Socket | null;
  isConnected: boolean;
  connectionState: ConnectionState;
  onlineCount: number;
  onlineUserIds: string[];
  emit: (event: string, data: any) => void;
  on: (event: string, handler: (...args: any[]) => void) => void;
  off: (event: string, handler: (...args: any[]) => void) => void;
}

// =====================================================================
// Reconnection Config — Exponential Backoff with Jitter
// =====================================================================

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;
const RECONNECT_JITTER_MS = 500;
const HEARTBEAT_INTERVAL_MS = 25000; // Match server pingInterval
const HEARTBEAT_TIMEOUT_MS = 10000; // If no pong within this, consider stale

// =====================================================================
// Singleton socket to prevent multiple connections
// =====================================================================

let _socket: Socket | null = null;
let _lastAuthData: { userId: string; role: string; unitId: string; userName: string; authToken: string } | null = null;
let _refCount = 0;

// =====================================================================
// Exponential backoff with jitter calculation
// =====================================================================

function calculateBackoffWithJitter(attempt: number): number {
  const exponential = Math.min(RECONNECT_BASE_DELAY_MS * Math.pow(2, attempt), RECONNECT_MAX_DELAY_MS);
  const jitter = Math.random() * RECONNECT_JITTER_MS;
  return Math.floor(exponential + jitter);
}

// =====================================================================
// Socket Creation with Optimized Reconnection
// =====================================================================

function getOrCreateSocket(): Socket {
  if (_socket) return _socket;

  // Auto-detect WebSocket URL based on environment
  const wsUrl = typeof window !== 'undefined' ? window.location.origin : '/';

  _socket = io(wsUrl, {
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 20,
    reconnectionDelay: RECONNECT_BASE_DELAY_MS,
    reconnectionDelayMax: RECONNECT_MAX_DELAY_MS,
    timeout: 20000,
    autoConnect: true,
    secure: typeof window !== 'undefined' && window.location.protocol === 'https:',
    // Use randomized factor to prevent thundering herd on server restart
    randomizationFactor: 0.5,
  });

  // Global connection logging — re-auth on reconnect
  _socket.on('connect', () => {
    console.log('[WS] Connected:', _socket?.id);
    if (_lastAuthData) {
      _socket?.emit('register', {
        userId: _lastAuthData.userId,
        roles: [_lastAuthData.role],
        unitId: _lastAuthData.unitId,
        userName: _lastAuthData.userName,
      });
    }
  });

  _socket.on('disconnect', (reason) => {
    console.log('[WS] Disconnected:', reason);
  });

  _socket.on('connect_error', (err) => {
    console.warn('[WS] Connection error:', err.message);
  });

  return _socket;
}

/** Force-disconnect the singleton socket (e.g., on logout) */
export function disconnectWebSocket(): void {
  if (_socket) {
    console.log('[WS] Force disconnecting singleton socket');
    _socket.disconnect();
    _socket = null;
    _lastAuthData = null;
    _refCount = 0;
  }
}

// =====================================================================
// Main Hook
// =====================================================================

export function useWebSocket(options: UseWebSocketOptions): UseWebSocketReturn {
  const { userId, role, unitId = '', userName = '', authToken = '', enabled = true } = options;
  const [isConnected, setIsConnected] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [onlineCount, setOnlineCount] = useState(0);
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);
  // Support multiple handlers per event using Set
  const handlersRef = useRef<Map<string, Set<(...args: any[]) => void>>>(new Map());
  // Heartbeat tracking
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeatTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const intentionalDisconnectRef = useRef(false);

  // =====================================================================
  // Heartbeat: detect stale connections via ping-pong
  // =====================================================================

  const startHeartbeat = useCallback((socket: Socket) => {
    stopHeartbeat();

    heartbeatTimerRef.current = setInterval(() => {
      if (!socket.connected) return;

      // Set a timeout — if no pong received, connection is stale
      heartbeatTimeoutRef.current = setTimeout(() => {
        console.warn('[WS] Heartbeat timeout — connection appears stale, forcing reconnect');
        socket.disconnect();
      }, HEARTBEAT_TIMEOUT_MS);

      // Send ping
      socket.emit('ping');
    }, HEARTBEAT_INTERVAL_MS);

    // Listen for pong to clear the timeout
    socket.on('pong', () => {
      if (heartbeatTimeoutRef.current) {
        clearTimeout(heartbeatTimeoutRef.current);
        heartbeatTimeoutRef.current = null;
      }
    });
  }, []);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
    if (heartbeatTimeoutRef.current) {
      clearTimeout(heartbeatTimeoutRef.current);
      heartbeatTimeoutRef.current = null;
    }
  }, []);

  // =====================================================================
  // Connection State Machine Transitions
  // =====================================================================

  const transitionState = useCallback((newState: ConnectionState) => {
    setConnectionState((prev) => {
      if (prev === newState) return prev;
      console.log(`[WS] State: ${prev} → ${newState}`);
      return newState;
    });
  }, []);

  useEffect(() => {
    if (!enabled || !userId) return;

    const socket = getOrCreateSocket();
    _refCount++;

    // Store auth data for reconnection
    _lastAuthData = { userId, role, unitId, userName, authToken };
    intentionalDisconnectRef.current = false;

    // Register with server using 'register' event
    const registerWithServer = () => {
      socket.emit('register', {
        userId,
        roles: [role],
        unitId,
        userName,
      });
    };

    // Auth immediately if connected, otherwise the global 'connect' handler will do it
    if (socket.connected) {
      registerWithServer();
    }

    // =====================================================================
    // State Machine: Track connection lifecycle
    // =====================================================================
    const onConnect = () => {
      setIsConnected(true);
      transitionState('connected');
      reconnectAttemptRef.current = 0; // Reset on successful connect
      // Re-auth on every reconnection
      registerWithServer();
      // Start heartbeat monitoring
      startHeartbeat(socket);
    };

    const onDisconnect = (reason: string) => {
      setIsConnected(false);
      stopHeartbeat();

      if (intentionalDisconnectRef.current) {
        transitionState('disconnected');
      } else if (reason === 'io server disconnect') {
        // Server forced disconnect — don't auto-reconnect, stay disconnected
        transitionState('disconnected');
      } else {
        // Network issue — will reconnect automatically
        transitionState('reconnecting');
      }
    };

    const onReconnectAttempt = (attempt: number) => {
      reconnectAttemptRef.current = attempt;
      const delay = calculateBackoffWithJitter(attempt - 1);
      transitionState('reconnecting');
      console.log(`[WS] Reconnect attempt ${attempt} (next in ~${delay}ms)`);
    };

    const onReconnectError = (err: Error) => {
      console.warn(`[WS] Reconnect error (attempt ${reconnectAttemptRef.current}):`, err.message);
    };

    const onReconnectFailed = () => {
      console.error('[WS] Reconnect failed after all attempts');
      transitionState('disconnected');
    };

    const onPresence = (data: { onlineCount: number; onlineUserIds: string[] }) => {
      setOnlineCount(data.onlineCount);
      setOnlineUserIds(data.onlineUserIds);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('reconnect_attempt', onReconnectAttempt);
    socket.on('reconnect_error', onReconnectError);
    socket.on('reconnect_failed', onReconnectFailed);
    socket.on('presence:update', onPresence);

    // Set initial state
    if (socket.connected) {
      transitionState('connected');
    } else {
      transitionState('connecting');
    }

    // Re-attach all registered handlers
    handlersRef.current.forEach((handlerSet, event) => {
      handlerSet.forEach(handler => socket.on(event, handler));
    });

    return () => {
      intentionalDisconnectRef.current = true;
      _refCount--;
      stopHeartbeat();
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('reconnect_attempt', onReconnectAttempt);
      socket.off('reconnect_error', onReconnectError);
      socket.off('reconnect_failed', onReconnectFailed);
      socket.off('presence:update', onPresence);

      // Remove all registered handlers
      handlersRef.current.forEach((handlerSet, event) => {
        handlerSet.forEach(handler => socket.off(event, handler));
      });

      if (_refCount <= 0 && _socket) {
        console.log('[WS] Destroying singleton socket');
        _socket.disconnect();
        _socket = null;
        _lastAuthData = null;
        _refCount = 0;
      }
    };
  }, [enabled, userId, role, unitId, userName, authToken, transitionState, startHeartbeat, stopHeartbeat]);

  const emit = useCallback((event: string, data: any) => {
    if (_socket?.connected) {
      _socket.emit(event, data);
    }
  }, []);

  const on = useCallback((event: string, handler: (...args: any[]) => void) => {
    // Support multiple handlers per event
    if (!handlersRef.current.has(event)) {
      handlersRef.current.set(event, new Set());
    }
    handlersRef.current.get(event)!.add(handler);
    if (_socket?.connected) {
      _socket.on(event, handler);
    }
  }, []);

  const off = useCallback((event: string, handler: (...args: any[]) => void) => {
    const handlerSet = handlersRef.current.get(event);
    if (handlerSet) {
      handlerSet.delete(handler);
      if (handlerSet.size === 0) {
        handlersRef.current.delete(event);
      }
    }
    if (_socket?.connected) {
      _socket.off(event, handler);
    }
  }, []);

  return {
    socket: _socket,
    isConnected,
    connectionState,
    onlineCount,
    onlineUserIds,
    emit,
    on,
    off,
  };
}
