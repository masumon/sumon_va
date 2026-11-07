# SUMON VA — COMPLETE SYSTEM UNDERSTANDING, ARCHITECTURE DISCOVERY & KNOWLEDGE DOCUMENTATION AUDIT

## 1. YOUR PROFESSIONAL ROLE

You are assigned as the **Principal System Architect, Senior Android Application Reverse-Engineering Specialist, Full-Stack Software Architect, Backend & API Architect, Database Architect, UI/UX Engineering Auditor, Android Platform Behaviour Specialist, Integration Engineer, Cybersecurity Auditor, QA & Reliability Engineer, and Technical Documentation Lead.**

You must operate with the combined expertise of a senior engineering team responsible for understanding and documenting a complete production-grade Android application and its connected backend infrastructure.

You are not being asked to perform a superficial code review.

Your primary responsibility is to understand the entire existing SUMON VA system as it actually exists in the repository, determine how every major component works and interacts, verify its implementation, identify problems, and create a reliable knowledge base for all future development.

**You must understand the system before attempting to change or improve it.**

---

## 2. PROJECT UNDERSTANDING — FIRST PRIORITY

The project is SUMON VA, a private Personal AI Brain and Unified Personal Communication Manager.

Its purpose is to help its owner manage communications, relationships, conversations, missed calls, messages, commitments, reminders, follow-ups, notifications and personal activities through a unified Android application connected to its backend intelligence system.

The application may interact with multiple communication channels, including:

- Phone Calls
- SMS
- WhatsApp
- Telegram
- Email
- Other implemented or planned communication platforms

The system is intended to understand communication context, identify people, recognize intent and urgency, remember relevant history, manage pending responses and commitments, and perform configured actions according to the owner's rules.

The application is private and intended for the owner's personal use.

Do not assume that the application is a generic messaging app, chatbot or ordinary task manager.

Understand the actual product purpose, existing implementation, user workflows and system responsibilities before making any technical conclusions.

---

## 3. PRIMARY MISSION

Conduct a complete repository-based understanding and audit of the following interconnected layers:

1. Android Application
2. Frontend Architecture
3. UI/UX Design System
4. Backend Architecture
5. API Ecosystem
6. Database Architecture
7. Authentication and Authorization
8. Android Native Integration
9. Background Processing
10. Notification and Communication Systems
11. AI and Intelligence Infrastructure
12. External Platform Integrations
13. Data Flow and Synchronization
14. Security and Privacy
15. Application Lifecycle and Runtime Behaviour
16. Testing and Reliability
17. Deployment and Infrastructure Configuration
18. User Workflows and Operating Procedures

You must establish how these layers work individually and together.

Do not begin the next development phase until the system has been sufficiently mapped and documented.

---

# 4. PHASE A — COMPLETE REPOSITORY DISCOVERY

First inspect the entire project repository.

### 4.1 Repository Structure

Identify and document:

- Root directory structure
- Android application directories
- Frontend directories
- Backend directories
- API and service directories
- Database and migration directories
- AI and Brain-related modules
- Shared libraries and components
- Configuration files
- Environment variable definitions
- Build and deployment configuration
- Testing directories
- Documentation
- Scripts and automation
- Third-party integrations

For each important directory and file, explain:

- Its responsibility
- What it contains
- Which components depend on it
- Which components it depends on
- Whether it is actively used
- Whether it appears obsolete, duplicated or disconnected

Do not assume that a file is active simply because it exists.

### 4.2 Existing Project State

Before investigation:

- Identify the current Git branch.
- Inspect Git status.
- Identify uncommitted changes.
- Review relevant commit history.
- Identify existing project documentation.
- Identify existing architecture decisions.
- Identify existing master prompts and previous audit reports.

Preserve all existing work.

Do not overwrite or delete existing documentation.

---

# 5. PHASE B — COMPLETE ANDROID APPLICATION UNDERSTANDING

Understand the Android application from its source code and actual implementation.

### 5.1 Application Architecture

Identify:

- Framework and runtime
- Android native components
- Kotlin/Java bridges, if present
- React Native/Expo or other frontend architecture, if present
- Application entry points
- Navigation architecture
- State management
- Local storage
- Network layer
- Authentication handling
- Background execution architecture
- Error handling
- Logging
- Build configuration

Explain how the application starts and how its components become operational.

### 5.2 Screen-by-Screen UI/UX Audit

Inspect every implemented screen.

For each screen, document:

1. Screen name and purpose
2. Entry and navigation path
3. UI components
4. Buttons and user actions
5. Input fields and validation
6. State management
7. API dependencies
8. Backend interactions
9. Database dependencies
10. Loading behaviour
11. Empty states
12. Error states
13. Success states
14. Notification behaviour
15. Navigation outcomes
16. Related screens and modules

Identify buttons, screens or components that:

- Work correctly
- Work partially
- Have no functional implementation
- Call incorrect APIs
- Display incorrect or stale data
- Have broken navigation
- Are disconnected from backend functionality
- Have inconsistent UI state
- Produce misleading success or error feedback

### 5.3 UI/UX Design System

Understand the complete visual and interaction system.

Inspect:

- Theme and color system
- Typography and fonts
- Font sizes and hierarchy
- Spacing and alignment
- Cards and containers
- Buttons and touch targets
- Icons
- Navigation patterns
- Dialogs and bottom sheets
- Forms and validation
- Lists and scrolling
- Responsive behaviour
- Dark/light mode, if implemented
- Accessibility
- TalkBack compatibility
- Font scaling
- Bengali and English localization
- Loading and feedback patterns

Determine whether the design system is consistent and whether the implemented UI accurately represents the application's intended functionality.

Do not redesign anything in this phase.

### 5.4 Frontend Behaviour

Trace how:

- User actions trigger callbacks.
- Components update state.
- State changes affect other components.
- API requests are initiated.
- API responses are processed.
- Errors are displayed.
- Data is cached.
- Offline states are handled.
- Screens refresh or synchronize.
- Background events affect the UI.

Document the actual flow rather than describing what the application should theoretically do.

---

# 6. PHASE C — ANDROID MOBILE BEHAVIOUR UNDERSTANDING

This is a critical audit area.

Understand how the application behaves as an Android application, not merely as a collection of source files.

### 6.1 Android Lifecycle

Inspect:

- Application launch
- Activity lifecycle
- App foreground/background transitions
- Process termination
- App restart
- Device reboot
- User logout/login
- Session expiration
- Permission revocation
- Network disconnection and restoration

### 6.2 Background Operations

Inspect all implemented mechanisms, including:

- Foreground Services
- Background Services
- WorkManager
- Broadcast Receivers
- Boot Receivers
- Notification Listeners
- SMS Receivers
- Call-related Receivers
- Background polling
- Scheduled tasks
- Retry mechanisms
- Offline queues
- Outbox processing
- RemoteInput actions

For every component, explain:

- What activates it
- What it receives
- What it processes
- What it sends
- Whether it requires a permission
- Whether it requires the app to remain open
- What happens if the process is killed
- What happens after device restart
- What happens without internet
- What happens if an operation fails

### 6.3 Android Permissions

Create a complete permission matrix.

Include:

- Permission name
- Android permission identifier
- Purpose
- Related feature
- Request location in code
- Runtime or special permission status
- User-facing explanation
- Current implementation status
- Security implications
- Android version limitations

Do not claim that a permission works at runtime based only on its declaration.

### 6.4 Realistic Android Behaviour Scenarios

Evaluate the implementation against these scenarios:

1. App is open.
2. App is in the background.
3. App is removed from recent apps.
4. App process is killed.
5. Phone is restarted.
6. Internet is disconnected.
7. Internet is restored.
8. Battery optimization restricts background activity.
9. A required permission is revoked.
10. A notification is dismissed.
11. An incoming call occurs.
12. An SMS arrives.
13. A supported messaging notification arrives.
14. The owner replies manually.
15. The owner is unavailable.
16. An API request fails.
17. A queued message cannot be delivered.
18. The app is updated.

For each scenario, distinguish:

- Verified implementation
- Code-level evidence only
- Unverified runtime behaviour
- Known Android platform limitation
- Missing implementation
- Potential failure

**IMPORTANT:** No Android phone, USB device or physical device testing is authorized in this audit. Do not attempt ADB, emulator testing, APK installation or physical device verification. Use repository evidence and available automated tests only.

---

# 7. PHASE D — COMPLETE BACKEND & SERVER UNDERSTANDING

Understand the entire backend system.

### 7.1 Backend Architecture

Identify:

- Backend framework
- Application entry point
- Routers
- Controllers
- Services
- Business logic
- Models
- Schemas
- Middleware
- Authentication
- Authorization
- Background workers
- Scheduler
- Webhooks
- External service clients
- Error handling
- Logging
- Configuration
- Deployment architecture

Explain how a request enters the server, passes through the system and produces a response.

### 7.2 Service and Module Relationships

For every important backend module, document:

- Module name
- Responsibility
- Main functions
- Input
- Output
- Dependencies
- Consumers
- Related APIs
- Related database tables
- External services
- Failure behaviour

Identify duplicate responsibilities, circular dependencies, disconnected modules and unused code.

### 7.3 API INVENTORY — MANDATORY

Build a complete API inventory.

For every endpoint, record:

| Field | Required Information |
|---|---|
| API ID | Unique reference |
| Method | GET / POST / PUT / PATCH / DELETE |
| Endpoint | Actual route |
| Router | Responsible router |
| Handler | Actual function |
| Purpose | What it does |
| Authentication | Required authentication |
| Authorization | Permission or role |
| Input | Request parameters/body |
| Output | Actual response schema |
| Database | Tables accessed |
| Frontend Consumer | Screen/component/service |
| Internal Dependencies | Related backend modules |
| External Dependencies | Connected services |
| Error Handling | Failure responses |
| Status | Verified implementation state |

Do not merely list API endpoints.

Trace the actual relationships between APIs.

Determine:

- Which APIs call other services.
- Which APIs share database tables.
- Which APIs depend on authentication.
- Which frontend components consume each API.
- Which API responses drive specific UI states.
- Whether any endpoint has no active consumer.
- Whether any UI feature has no valid backend endpoint.
- Whether API contracts differ between frontend and backend.

Create an API-to-Frontend-to-Backend-to-Database relationship map.

---

# 8. PHASE E — DATABASE ARCHITECTURE UNDERSTANDING

Inspect the actual database definitions and migration history.

Document:

- Tables
- Columns
- Data types
- Primary keys
- Foreign keys
- Relationships
- Indexes
- Constraints
- Triggers
- Functions
- Views
- RLS policies
- Migration sequence
- Database ownership
- Data retention rules, if implemented

For every major table, explain:

1. What information it stores.
2. Which module writes to it.
3. Which module reads from it.
4. Which API accesses it.
5. Which UI uses its data.
6. Which other tables it relates to.
7. Whether it contains sensitive information.
8. Whether access controls are appropriate.

Create an Entity Relationship overview.

Trace important data flows:

**Android → API → Backend Service → Database → Backend Response → Android UI**

Also inspect reverse and asynchronous flows.

Identify:

- Duplicate data structures
- Unused tables
- Missing relationships
- Inconsistent field names
- Data integrity risks
- Missing indexes
- RLS gaps
- Migration inconsistencies
- Data synchronization risks

Do not modify the database or execute migrations.

Production database access must remain read-only.

---

# 9. PHASE F — FRONTEND ↔ BACKEND ↔ DATABASE CONNECTION AUDIT

This phase connects all previous findings.

Trace actual end-to-end workflows.

For each major user action, determine:

1. Which screen initiates the action?
2. Which frontend function executes?
3. Which API is called?
4. Which backend handler receives it?
5. Which service processes it?
6. Which database tables are read or written?
7. What response is returned?
8. How the frontend processes the response?
9. How the UI changes?
10. What happens if any step fails?

Create diagrams for important workflows using Mermaid where useful.

Examples:

- App startup and authentication
- Dashboard data loading
- Inbox message retrieval
- Contact details loading
- Message ingestion
- Task creation
- Reminder scheduling
- Notification delivery
- Owner approval workflow
- Background synchronization
- Offline queue recovery

Identify broken, incomplete or inconsistent connections.

A frontend feature must not be considered complete merely because its screen exists.

A backend feature must not be considered complete merely because its endpoint exists.

A database table must not be considered active merely because it exists.

---

# 10. PHASE G — AI, BRAIN & INTELLIGENCE INFRASTRUCTURE

Understand the existing AI infrastructure without conducting the next-stage 18-module functional audit.

Identify:

- AI orchestration
- AI providers
- Model configuration
- Prompt management
- Context construction
- Memory storage
- Retrieval mechanisms
- Conversation processing
- Intent detection
- Decision-making
- Response generation
- Approval mechanisms
- Privacy guards
- Fallback handling
- Logging
- Provider failure handling

Document how the AI system connects to:

- Android
- Backend APIs
- Database
- Communication channels
- Memory
- Tasks
- Notifications
- Scheduler

Explain the actual architecture and data flow.

Do not redesign the Brain architecture or implement new intelligence features.

The detailed functional verification of all 18 Brain domains will be conducted in a separate subsequent audit.

---

# 11. PHASE H — EXTERNAL INTEGRATION AUDIT

Identify every external service or platform used or intended to be used.

Examples include:

- WhatsApp
- Telegram
- Email
- Google services
- AI providers
- Supabase
- Cloud infrastructure
- Other connected APIs

For each integration, document:

- Purpose
- Authentication method
- Credentials/configuration references (never expose secret values)
- API endpoints
- Webhook configuration
- Incoming data flow
- Outgoing data flow
- Database dependencies
- Retry and failure handling
- Current code-level status
- Available test evidence
- External approval or configuration requirements

Classify each integration as:

- Operational and verified
- Partially operational
- Implemented but unverified
- Configured but disconnected
- Missing
- Blocked by external service
- Blocked by permission or approval
- Platform limitation

Never expose API keys, tokens, passwords or personal communication content in the documentation.

---

# 12. PHASE I — SECURITY, PRIVACY & RELIABILITY

Audit:

- Authentication
- Authorization
- Session management
- Token handling
- API access controls
- Database RLS
- Input validation
- Sensitive data exposure
- Local storage security
- Network security
- Webhook verification
- Rate limiting
- Error handling
- Logging privacy
- AI data access
- Permission boundaries
- Background execution security
- Message delivery integrity
- Duplicate processing
- Queue recovery
- Backup and recovery

Identify security risks and reliability weaknesses.

Prioritize findings:

- P0 — Critical
- P1 — High
- P2 — Medium
- P3 — Low

For each issue, include evidence, affected components, possible impact and recommended remediation.

Do not make changes in this audit.

---

# 13. PHASE J — TESTING & IMPLEMENTATION VERIFICATION

Inspect all existing tests and available test infrastructure.

Identify:

- Unit tests
- Integration tests
- API tests
- Database tests
- Frontend tests
- Android tests
- Build validation
- Static analysis
- Linting
- Type checking
- Security checks

Run only safe, repository-based tests that do not modify production systems or destroy existing work.

For every test, report:

- Command executed
- Scope
- Result
- Failure details
- Evidence
- Limitations

Do not report a test as passed if it was not executed.

Do not claim device behaviour is verified without physical device testing.

---

# 14. PHASE K — CREATE PERMANENT SYSTEM KNOWLEDGE

This is one of the most important deliverables.

After understanding and auditing the system, create a separate documentation file at the project root:

`SUMON_VA_SYSTEM_KNOWLEDGE.md`

This file must become the primary technical reference for future SUMON VA development.

It must be detailed enough that another qualified AI coding agent or engineer can understand the system without having to rediscover the entire architecture.

### Required Documentation Structure

1. Project Identity and Purpose
2. Product Scope and User Requirements
3. Complete Repository Structure
4. Technology Stack
5. Android Application Architecture
6. Frontend Architecture
7. UI/UX Design System
8. Screen-by-Screen Documentation
9. User Interaction and Navigation Flows
10. Android Lifecycle and Runtime Behaviour
11. Android Permissions
12. Background Services and Receivers
13. Backend Architecture
14. Backend Module Inventory
15. Complete API Inventory
16. API Dependency and Relationship Map
17. Database Schema Overview
18. Entity Relationship Documentation
19. API-to-Database Mapping
20. Frontend-to-Backend Mapping
21. End-to-End Data Flow
22. AI and Brain Architecture
23. Memory and Context Infrastructure
24. Communication Channel Integrations
25. External Service Dependencies
26. Authentication and Security
27. Offline and Synchronization Behaviour
28. Notifications and Alert System
29. Scheduler and Background Processing
30. Error Handling and Recovery
31. Build and Deployment Architecture
32. Testing Infrastructure
33. Known Problems and Technical Debt
34. Missing or Disconnected Features
35. Android Platform Limitations
36. Environment and Configuration Requirements
37. Application Operating Instructions
38. User Workflow Guide
39. Development and Maintenance Guide
40. Future Development Constraints
41. Verification Evidence and Audit Date
42. Unverified Areas and Outstanding Questions

### Documentation Quality Requirements

- Use clear, professional English.
- Use tables for inventories and mappings.
- Use Mermaid diagrams for important architecture and workflows.
- Include actual repository paths, function names, class names and API routes.
- Explain technical terminology where necessary.
- Distinguish verified facts from assumptions.
- Reference source files and relevant line numbers where practical.
- Never include secret values or private message contents.
- Include an update history and document version.

Do not create generic documentation.

Every major statement must be grounded in the actual repository or available test evidence.

---

# 15. AGENT MEMORY — FUTURE WORK CONTEXT

In addition to the documentation file, prepare a concise and structured system context for future agent sessions.

Use the available persistent project/agent memory mechanism if one exists and is authorized.

If no such mechanism exists, create:

`SUMON_VA_AGENT_MEMORY.md`

This memory must contain:

- What SUMON VA is
- Its exact purpose
- Its existing architecture
- Important repository paths
- Main Android components
- Main frontend components
- Main backend services
- Important API relationships
- Database structure overview
- Important data flows
- Critical integration dependencies
- Existing verified functionality
- Known bugs and risks
- Unverified behaviour
- Important platform limitations
- Development restrictions
- Documentation reference
- Next-stage audit instructions

Keep the memory concise enough to be useful at the beginning of future sessions.

The detailed documentation file remains the authoritative technical reference. The memory file is the quick-start context.

Do not claim that memory has been saved unless the relevant mechanism confirms it.

---

# 16. APPLICATION OPERATING MANUAL

The system knowledge must also explain how the owner is expected to use the application.

Create:

`SUMON_VA_USER_GUIDE.md`

Document:

- Application purpose
- Main screens
- Navigation
- Available features
- Contact management
- Communication workflows
- Notification behaviour
- Task and reminder management
- AI interaction
- Approval and auto-reply settings
- Permissions and why they are required
- Offline behaviour
- Common errors
- Recovery procedures
- Settings and configuration
- Important limitations

Explain what the owner should expect when performing each important action.

Do not invent a feature or instruction that is not supported by the existing implementation.

Clearly distinguish:

- Currently available
- Partially available
- Not available
- Requires configuration or permission
- Requires external integration

---

# 17. AUDIT FINDINGS CLASSIFICATION

Every significant component and feature must receive one of these statuses:

| Status | Meaning |
|---|---|
| VERIFIED WORKING | Implementation and available test evidence confirm correct behaviour |
| IMPLEMENTED — UNVERIFIED | Code exists, but sufficient operational evidence is unavailable |
| PARTIALLY IMPLEMENTED | Some required functionality works; other parts are incomplete |
| INCORRECT IMPLEMENTATION | Existing implementation contains a verified defect |
| INTEGRATION FAILURE | Components exist but their connection does not work correctly |
| MISSING | Required implementation is absent |
| CONFIGURATION BLOCKED | Requires environment or service configuration |
| PERMISSION BLOCKED | Requires Android or user authorization |
| EXTERNAL BLOCKED | Requires an external provider, API approval or service |
| PLATFORM LIMITED | Android or external platform restricts the expected behaviour |
| NOT APPLICABLE | The feature does not apply to the existing system |

Never confuse code existence with working functionality.

Never confuse a successful API health check with complete system functionality.

Never use unsupported completion percentages.

---

# 18. REQUIRED AUDIT DELIVERABLES

Create these files at the repository root:

1. `SUMON_VA_SYSTEM_KNOWLEDGE.md`
   - Complete technical architecture and system knowledge.

2. `SUMON_VA_AGENT_MEMORY.md`
   - Concise future-session context and operational constraints.

3. `SUMON_VA_USER_GUIDE.md`
   - Application purpose, usage instructions and limitations.

4. `SUMON_VA_SYSTEM_AUDIT_REPORT.md`
   - Complete findings, evidence, problems and verification results.

5. `SUMON_VA_API_INVENTORY.md`
   - Complete endpoint inventory and API relationships.

6. `SUMON_VA_DATA_FLOW_MAP.md`
   - Frontend, backend, database and integration workflows.

7. `SUMON_VA_ANDROID_BEHAVIOUR_AUDIT.md`
   - Lifecycle, permissions, background processing and platform limitations.

8. `SUMON_VA_ISSUES_AND_RISKS.md`
   - Prioritized defects, security concerns and technical debt.

9. `SUMON_VA_DOCUMENTATION_INDEX.md`
   - Index explaining the purpose and contents of every generated document.

If equivalent current documentation already exists, inspect and reuse it. Do not overwrite valuable existing material. Update or create versioned documents safely.

---

# 19. STRICT OPERATIONAL RESTRICTIONS

During this entire audit:

- Do not modify application source code.
- Do not refactor existing code.
- Do not implement new features.
- Do not redesign UI/UX.
- Do not modify API contracts.
- Do not modify database schemas.
- Do not execute database migrations.
- Do not modify production data.
- Do not change production environment variables.
- Do not expose secrets.
- Do not deploy to production.
- Do not build or install an APK as part of this phase.
- Do not connect to or test a physical Android device.
- Do not use ADB, USB or emulator testing.
- Do not delete or overwrite existing project files.
- Do not discard uncommitted Git changes.
- Do not make speculative architecture replacements.

The only permitted file changes are the new audit and knowledge documentation deliverables described above, or safe updates to those newly created documents.

Existing master directives and previous reports must remain preserved.

If an existing master directive imposes additional safety restrictions, follow the stricter requirement.

---

# 20. EVIDENCE AND ACCURACY REQUIREMENTS

For every important finding, provide:

- Repository path
- Relevant class/function/API/table
- Actual implementation evidence
- Related dependencies
- Verification method
- Result
- Limitation
- Confidence level

Use these evidence labels:

- SOURCE VERIFIED
- TEST VERIFIED
- CONFIGURATION VERIFIED
- DATABASE DEFINITION VERIFIED
- RUNTIME VERIFIED
- NOT RUNTIME VERIFIED
- INFERRED
- UNAVAILABLE

Do not invent runtime evidence.

Do not claim a feature works simply because its code looks correct.

If the repository cannot prove a behaviour, explicitly record it as unverified.

If external credentials, permissions or services are unavailable, record the limitation instead of attempting unauthorized access.

---

# 21. REQUIRED FINAL REPORT

After completing the investigation and documentation, provide a comprehensive Bengali report containing:

### A. Executive Summary
What the application and server actually contain and how they work together.

### B. System Architecture
Android, frontend, backend, database, AI and external integrations.

### C. Application Understanding
Screen-by-screen and workflow-level findings.

### D. API Understanding
Total discovered endpoints, their purposes, dependencies and frontend consumers.

### E. Database Understanding
Tables, relationships, RLS and major data flows.

### F. Android Behaviour
Lifecycle, permissions, background processing, notifications and known limitations.

### G. End-to-End Connectivity
Which components communicate correctly and which connections are broken or unverified.

### H. Correctly Implemented Components
Only evidence-supported findings.

### I. Problems and Defects
Detailed issues with severity, evidence and affected components.

### J. Missing and Incomplete Areas
Features, integrations and documentation that remain incomplete.

### K. Security and Reliability
P0–P3 findings.

### L. Documentation Created
List every generated file and its purpose.

### M. System Knowledge Readiness
Explain whether a future agent can understand the system using the new documentation, and identify any remaining knowledge gaps.

### N. Recommended Next Steps
Provide a logical, dependency-aware sequence for subsequent work.

### O. Next Audit Readiness
Explain whether the repository is sufficiently understood to begin the separate 18 Intelligence Domains Functional Audit.

---

# 22. EXECUTION ORDER

Follow this order strictly:

1. Inspect repository and Git state.
2. Discover all application and server components.
3. Understand Android architecture and mobile behaviour.
4. Understand frontend screens, UI/UX and state management.
5. Understand backend architecture and services.
6. Inventory and trace APIs.
7. Understand database structure and relationships.
8. Map frontend ↔ API ↔ backend ↔ database connections.
9. Understand AI and communication integrations.
10. Audit security, reliability and test evidence.
11. Identify correct, incorrect, incomplete and unverified implementations.
12. Create the complete system knowledge documentation.
13. Create concise agent memory.
14. Create the user operating guide.
15. Validate consistency across all generated documents.
16. Produce the final Bengali audit report.

Do not skip steps or jump directly to conclusions.

---

# 23. FINAL DIRECTIVE

Your goal is not to make the application look complete on paper.

Your goal is to discover and document the actual system.

You must understand:

- What exists.
- Why it exists.
- How it works.
- How it connects.
- What depends on it.
- What data it handles.
- What the user experiences.
- What works correctly.
- What works incorrectly.
- What is incomplete.
- What cannot yet be verified.
- What must be preserved during future development.

**The completed knowledge base must allow a future AI engineering agent to understand SUMON VA before modifying it, navigate the correct files, identify the correct APIs, understand the database relationships, follow actual data flows, respect Android limitations and avoid unnecessary assumptions.**

Do not start the separate 18-domain Brain Functional Audit in this phase.

Do not start implementation in this phase.

First establish complete system understanding, verify the available evidence, identify problems and create the permanent knowledge base.

**FINAL OBJECTIVE: UNDERSTAND THE ENTIRE SYSTEM → MAP ITS RELATIONSHIPS → VERIFY ITS REAL BEHAVIOUR → IDENTIFY ITS PROBLEMS → DOCUMENT EVERYTHING → PREPARE RELIABLE FUTURE AGENT KNOWLEDGE.**