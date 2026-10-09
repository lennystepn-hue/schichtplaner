# Database Schema — Schichtplaner

Entity-relationship diagram of the Prisma models (the NextAuth tables `Session` and `VerificationToken` are omitted).

Access model: a weekly plan (`Schedule`) belongs to exactly one location (`Branch`), a location to one customer (`Customer`). Managers and employees reach locations only through `BranchAccess` (rights per location) and people only through `StaffAssignment` (rights per assigned person). OWNER and ADMIN have organisation-wide access. Plans without a location are legacy data and visible to admins only. Composite foreign keys and the trigger `akro_same_organization` keep all links inside one organisation.

```mermaid
erDiagram
    User ||--o{ OrganizationMember : "memberships"
    User ||--o{ Booking : "booked"
    User ||--o{ TimeRecord : "tracks"
    User ||--o{ Absence : "requests"
    User ||--o{ Message : "sends"
    User ||--o{ MessageRecipient : "receives"
    User ||--o{ ModRequest : "submits"
    User ||--o{ LiveLog : "logs"
    User ||--o{ TopicPost : "writes"
    User ||--o{ PortalFile : "uploads"
    User ||--o{ EmployeeNote : "subject of"
    User ||--o{ EmployeeNote : "authored"

    Organization ||--o{ OrganizationMember : "has"
    Organization ||--o{ Customer : "has"
    Organization ||--o{ Branch : "has"
    Organization ||--o{ Division : "has"
    Organization ||--o{ Schedule : "has"
    Organization ||--o{ TimeCategory : "has"
    Organization ||--o{ AbsenceCategory : "has"
    Organization ||--o{ Message : "has"
    Organization ||--o{ PortalFolder : "has"
    Organization ||--o{ PortalFile : "has"
    Organization ||--o{ Topic : "has"
    Organization ||--o{ Holiday : "has"
    Organization ||--|| OrgSettings : "has"
    Organization ||--o| TimeSettings : "has"

    OrganizationMember }o--|| Organization : "belongs to"
    OrganizationMember }o--|| User : "belongs to"
    OrganizationMember ||--o{ BranchAccess : "granted"
    OrganizationMember ||--o{ StaffAssignment : "manages"
    OrganizationMember ||--o{ StaffAssignment : "assigned to"
    OrganizationMember ||--o{ BranchIssue : "responsible for"
    OrganizationMember ||--o{ Availability : "has"

    Customer }o--|| Organization : "belongs to"
    Customer ||--o{ Branch : "has"

    Branch }o--|| Organization : "belongs to"
    Branch }o--o| Customer : "legacy rows may be unassigned"
    Branch ||--o{ Schedule : "has"
    Branch ||--o{ BranchAccess : "grants"
    Branch ||--o{ BranchIssue : "has"
    Branch ||--o{ TimeRecord : "assigned"

    Division }o--|| Organization : "belongs to"
    Division ||--o{ DivisionMember : "has"
    Division ||--o{ Shift : "has"

    Schedule }o--|| Organization : "belongs to"
    Schedule }o--o| Branch : "location (null = legacy)"
    Schedule ||--o{ Shift : "has"
    Schedule ||--o{ Briefing : "has"
    Schedule ||--o| LiveSession : "has"

    Shift }o--|| Schedule : "belongs to"
    Shift }o--o| Division : "optional"
    Shift ||--o{ Booking : "has"
    Shift ||--o{ ModRequest : "has"

    LiveSession ||--o{ LiveDay : "has"
    LiveSession ||--o{ LiveLog : "has"

    TimeRecord }o--o| TimeCategory : "optional"
    TimeRecord ||--o{ TimeCorrection : "has"
    Absence }o--|| AbsenceCategory : "has"

    Message }o--o| Message : "reply to"
    Message ||--o{ MessageRecipient : "has"

    PortalFolder }o--o| PortalFolder : "subfolder of"
    PortalFolder ||--o{ PortalFile : "contains"

    Topic ||--o{ TopicPost : "has"

    User {
        string id PK
        string email UK
        string passwordHash
        string firstName
        string lastName
        string nickname
        string phone
        string profileImage
        string locale
        datetime createdAt
    }

    Organization {
        string id PK
        string name
        string address
        enum nameFormat
        datetime createdAt
        datetime deletedAt
    }

    OrganizationMember {
        string id PK
        string organizationId FK
        string userId FK
        enum role
        boolean isActive
        boolean isActivated
        string position
        string employmentType
        float targetHoursPerWeek
        string_array qualifications
        string activationToken UK
    }

    Customer {
        string id PK
        string organizationId FK
        string name
        string notes
        boolean isActive
    }

    Branch {
        string id PK
        string organizationId FK
        string customerId FK
        string name
        string address
        string meetingPoint
        string notes
        string_array positions
        boolean isActive
    }

    BranchAccess {
        string id PK
        string organizationId FK
        string memberId FK
        string branchId FK
        enum_array rights
    }

    StaffAssignment {
        string id PK
        string organizationId FK
        string managerMemberId FK
        string employeeMemberId FK
        enum_array rights
    }

    BranchIssue {
        string id PK
        string organizationId FK
        string branchId FK
        string title
        string description
        enum status
        string assigneeMemberId FK
        string createdById FK
        datetime resolvedAt
    }

    Division {
        string id PK
        string organizationId FK
        string title
        string description
        string color
        boolean isSystem
        datetime deletedAt
    }

    Schedule {
        string id PK
        string organizationId FK
        string branchId FK
        int weekNumber
        int year
        boolean isPublic
        enum settingsLayout
    }

    Shift {
        string id PK
        string scheduleId FK
        string divisionId FK
        int dayOfWeek
        string shiftFrom
        string shiftTo
        int maxEmployees
        enum pauseOption
        int pauseValue
        string_array requiredQualifications
    }

    Booking {
        string id PK
        string shiftId FK
        string userId FK
        datetime bookedAt
        string bookedBy
        datetime confirmedAt
    }

    ModRequest {
        string id PK
        string shiftId FK
        string userId FK
        string kind
        enum state
        string targetUserId
        string note
        datetime deadline
    }

    Briefing {
        string id PK
        string scheduleId FK
        string text
        datetime createdAt
    }

    LiveSession {
        string id PK
        string scheduleId FK_UK
        boolean isActive
        datetime deadline
        boolean autoStop
        boolean allowExceeds
        boolean bookRequests
    }

    LiveDay {
        string id PK
        string liveSessionId FK
        int dayOfWeek
        boolean enabled
    }

    LiveLog {
        string id PK
        string liveSessionId FK
        string shiftId
        string userId FK
        enum action
        datetime loggedAt
    }

    TimeRecord {
        string id PK
        string userId FK
        string organizationId FK
        string branchId FK
        date date
        string timeFrom
        string timeTo
        int durationHours
        int durationMinutes
        enum type
        string categoryId FK
        string comment
        datetime startedAt
        datetime endedAt
        int breakSeconds
    }

    TimeCorrection {
        string id PK
        string organizationId FK
        string recordId FK
        string requesterId
        string reason
        json before
        json proposed
        enum status
    }

    Availability {
        string id PK
        string organizationId FK
        string userId FK
        date date
        string timeFrom
        string timeTo
        boolean available
    }

    TimeCategory {
        string id PK
        string organizationId FK
        string name
        boolean enabled
    }

    TimeSettings {
        string id PK
        string organizationId FK_UK
        string trackingOptions
        boolean watchAutoStop
        boolean warningsEnabled
        int warningsMaxHours
        enum whoCanUse
        boolean useCategories
    }

    Absence {
        string id PK
        string userId FK
        string categoryId FK
        date dateFrom
        date dateTo
        string note
        enum status
    }

    AbsenceCategory {
        string id PK
        string organizationId FK
        string name
        string color
        boolean isPaid
    }

    Holiday {
        string id PK
        string organizationId FK
        string name
        date date
        string country
        string state
    }

    Message {
        string id PK
        string organizationId FK
        string senderId FK
        string subject
        string body
        string parentId FK
        string shiftId
    }

    MessageRecipient {
        string messageId PK_FK
        string userId PK_FK
        boolean isRead
        boolean isDeleted
    }

    PortalFolder {
        string id PK
        string organizationId FK
        string parentId FK
        string name
    }

    PortalFile {
        string id PK
        string organizationId FK
        string folderId FK
        string name
        string path
        int size
        string mimeType
        string uploadedById FK
    }

    Topic {
        string id PK
        string organizationId FK
        string title
        string createdById
    }

    TopicPost {
        string id PK
        string topicId FK
        string userId FK
        string text
        datetime createdAt
    }

    EmployeeNote {
        string id PK
        string subjectId FK
        string authorId FK
        string text
        datetime createdAt
    }

    OrgSettings {
        string id PK
        string organizationId FK_UK
        boolean aiEnabled
        boolean aiAutoPlanner
        boolean aiAnomalyDetection
        boolean aiChatEnabled
        boolean aiForecast
        boolean aiSmartBriefing
        boolean smsEnabled
    }
```
