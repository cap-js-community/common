using test from '../db/schema';

@cds.rateLimit
service TestService {
    entity Books @readonly   as projection on test.Books;
    entity Pages @readonly   as projection on test.Pages;
    entity Quotes @readonly  as projection on test.Quotes;
    entity Authors @readonly as projection on test.Authors;

    @odata.draft.enabled
    entity Draft @readonly as projection on test.Draft {
        ID,
        name,
    };
};
