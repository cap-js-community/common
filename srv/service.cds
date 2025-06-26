using test from '../db/schema';

@cds.rateLimiting
service TestService {
    entity Books @readonly   as projection on test.Books;
    entity Pages @readonly   as projection on test.PagesView;
    entity Quotes @readonly  as projection on test.Quotes;
    entity Authors @readonly as projection on test.Authors;

    entity Enum @readonly as projection on test.Enum;

    @odata.draft.enabled
    entity Draft @readonly as projection on test.Draft {
        ID,
        name,
    };
};
