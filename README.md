# Real-Time Collaborative Text Editor

A full-stack collaborative text editor built with Next.js, Express,
Socket.io, PostgreSQL, and a custom simplified Operational
Transformation engine.

## Features

- User registration and JWT authentication
- bcrypt password hashing
- Protected HTTP and Socket.io connections
- Owner, editor, and viewer permissions
- Document creation and management
- Real-time collaborative editing
- Custom retain, insert, and delete operations
- Server-authoritative document versioning
- Operational Transformation for concurrent edits
- Pending-operation queue for rapid typing
- Reconnect recovery using operation history
- Debounced PostgreSQL persistence
- Graceful server shutdown
- Collaborator and role management
- Active-user presence
- HTTP and WebSocket payload limits
- API rate limiting

## Architecture

Next.js and React frontend
        |
        | HTTP and Socket.io
        |
Node.js and Express backend
        |
        | PostgreSQL protocol
        |
PostgreSQL database