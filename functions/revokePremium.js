const promisePool = require('es6-promise-pool');
const PromisePool = promisePool.PromisePool;
// Maximum concurrent account deletions.
const MAX_CONCURRENT = 3;

var admin;

exports.handler = async function (pAdmin) {
    admin = pAdmin;

    const expiredUsers = await getExpiredUsers();

    console.log("Users with expired premium count: " + expiredUsers.length);

    // Use a pool so that we delete maximum `MAX_CONCURRENT` users in parallel.
    const promisePool = new PromisePool(() => revokeExpiredUser(expiredUsers), MAX_CONCURRENT);
    await promisePool.start();
    console.log('Revoke users with expired premium finished');
}

/* Revokes expired premium of one user from the list. */
function revokeExpiredUser(expiredUsers) {
    if (expiredUsers.length > 0) {
        const userToRevoke = expiredUsers.pop();

        const claims = userToRevoke.customClaims;
        delete claims.premium;

        return admin.auth().setCustomUserClaims(userToRevoke.uid, claims).then(() => {
            return console.log('Revoked premium of', userToRevoke.uid, 'because of expiration');
        }).catch(function (error) {
            return console.error('Revocation of user with expired premium', userToRevoke.uid, 'failed:', error);
        });
    } else {
        return null;
    }
}

async function getExpiredUsers(users = [], nextPageToken) {
    const result = await admin.auth().listUsers(1000, nextPageToken);
    // Find users that premium has expired
    const expiredUsers = result.users.filter((user) => {
        const premium = user.customClaims && user.customClaims.premium;
        if (premium) {
            return new Date(premium.expiry) <= Date.now();
        }
        return false;
    });

    // Concat with list of previously found expired users if there was more than 1000 users.
    users = users.concat(expiredUsers);

    // If there are more users to fetch we fetch them.
    if (result.pageToken) {
        return getExpiredUsers(users, result.pageToken);
    }

    return users;
}