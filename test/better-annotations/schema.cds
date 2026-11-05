namespace betterAnnotations.test;

using { managed } from '@sap/cds/common';

entity Orders : managed {
  key ID    : UUID;
      item  : String;
      qty   : Integer;
      price : Decimal;
}

entity Products : managed {
  key ID    : UUID;
      name  : String;
      descr : String;
      stock : Integer;
}

entity Reviews : managed {
  key ID        : UUID;
      title     : String;
      rating    : Integer;
      createdBy : String;
}

entity Tickets : managed {
  key ID         : UUID;
      subject    : String;
      status     : String;
      assignedTo : String;
}

entity Logs {
  key ID      : UUID;
      message : String;
      level   : String;
}

entity ReadOnlyItems {
  key ID   : UUID;
      name : String;
}

entity NoUIEntity {
  key ID   : UUID;
      data : String;
}

// Composition: Books → Pages (parent-path where clause test)
entity Books : managed {
  key ID        : UUID;
      title     : String;
      createdBy : String;
      pages     : Composition of many Pages on pages.book = $self;
}

entity Pages : managed {
  key ID        : UUID;
      book      : Association to Books;
      content   : String;
      pageNo    : Integer;
}

// Exists-clause test: Projects with members
entity Projects : managed {
  key ID      : UUID;
      title   : String;
      members : Composition of many ProjectMembers on members.project = $self;
}

entity ProjectMembers : managed {
  key ID      : UUID;
      project : Association to Projects;
      userID  : String;
}
