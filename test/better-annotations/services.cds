using { betterAnnotations.test as db } from './schema';

@requires: 'authenticated-user'
service TestBetterAnnotationsService {

  // Case 1: Static — no CREATE/DELETE granted, UPDATE only to Admin
  @restrict: [
    { grant: ['READ'], to: ['Employee', 'Admin'] },
    { grant: ['UPDATE'], to: ['Admin'] }
  ]
  entity Orders as projection on db.Orders;

  // Case 2: Role-based — CREATE/UPDATE/DELETE only for specific roles (no where)
  @restrict: [
    { grant: ['READ'], to: ['Employee', 'Admin', 'Manager'] },
    { grant: ['CREATE', 'UPDATE', 'DELETE'], to: ['Admin', 'Manager'] }
  ]
  entity Products as projection on db.Products;

  // Case 3: Where clause — UPDATE/DELETE conditional on $user.id = createdBy
  @restrict: [
    { grant: ['READ'], to: ['Employee', 'Admin'] },
    { grant: ['CREATE'], to: ['Employee', 'Admin'] },
    { grant: ['UPDATE', 'DELETE'], to: ['Admin'] },
    { grant: ['UPDATE', 'DELETE'], to: ['Employee'], where: 'createdBy = $user.id' }
  ]
  entity Reviews as projection on db.Reviews;

  // Case 4: Actions with @restrict
  @restrict: [
    { grant: ['READ'], to: ['Employee', 'Admin'] },
    { grant: ['*'], to: ['Admin'] },
    { grant: ['approve'], to: ['Manager'] },
    { grant: ['reject'], to: ['Manager'], where: 'assignedTo = $user.id' }
  ]
  entity Tickets as projection on db.Tickets actions {
    action approve();
    action reject();
    action escalate();
  };

  // Case 5: grant * to all (everyone can do everything) — no annotation needed
  @restrict: [
    { grant: ['*'] }
  ]
  entity Logs as projection on db.Logs;

  // Case 6: @readonly entity
  @readonly
  @restrict: [
    { grant: ['READ'], to: ['Employee'] }
  ]
  entity ReadOnlyItems as projection on db.ReadOnlyItems;

  // Case 7: Entity WITH @restrict but WITHOUT @UI annotations — should be skipped
  @restrict: [
    { grant: ['READ', 'WRITE'], to: ['Admin'] }
  ]
  entity NoUIEntity as projection on db.NoUIEntity;

  // Case 8: Composition parent — Books owned by creator
  @restrict: [
    { grant: ['READ'], to: ['Employee', 'Admin'] },
    { grant: ['*'], to: ['Admin'] },
    { grant: ['UPDATE', 'DELETE'], to: ['Employee'], where: 'createdBy = $user.id' }
  ]
  entity Books as projection on db.Books;

  // Case 9: Composition child — Pages. CREATE/UPDATE/DELETE only if user owns parent Book
  @restrict: [
    { grant: ['READ'], to: ['Employee', 'Admin'] },
    { grant: ['*'], to: ['Admin'] },
    { grant: ['CREATE', 'UPDATE', 'DELETE'], to: ['Employee'], where: 'book.createdBy = $user.id' }
  ]
  entity Pages as projection on db.Pages;
}

// UI annotations — entities that have these qualify for betterAnnotations processing
annotate TestBetterAnnotationsService.Orders with @UI.LineItem: [
  { Value: item },
  { Value: qty },
  { Value: price }
];

annotate TestBetterAnnotationsService.Products with @UI.LineItem: [
  { Value: name },
  { Value: stock }
];

annotate TestBetterAnnotationsService.Reviews with @UI.LineItem: [
  { Value: title },
  { Value: rating }
];

annotate TestBetterAnnotationsService.Tickets with @UI.LineItem: [
  { Value: subject },
  { Value: status }
];

annotate TestBetterAnnotationsService.Logs with @UI.LineItem: [
  { Value: message },
  { Value: level }
];

annotate TestBetterAnnotationsService.ReadOnlyItems with @UI.LineItem: [
  { Value: name }
];

// Note: NoUIEntity intentionally has NO @UI annotations

// Composition test: Books with Pages (parent-path where clause)
annotate TestBetterAnnotationsService.Books with @UI.LineItem: [
  { Value: title }
];

annotate TestBetterAnnotationsService.Pages with @UI.LineItem: [
  { Value: content },
  { Value: pageNo }
];
