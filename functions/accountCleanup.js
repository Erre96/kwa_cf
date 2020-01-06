const promisePool = require('es6-promise-pool');
const PromisePool = promisePool.PromisePool;
// Maximum concurrent account deletions.
const MAX_CONCURRENT = 3;

var admin;

exports.handler = async function (pAdmin) {
    admin = pAdmin;

    const inactiveUsers = await getInactiveUsers();

    console.log("Inactive users count: " + inactiveUsers.length);

    // Use a pool so that we delete maximum `MAX_CONCURRENT` users in parallel.
    const promisePool = new PromisePool(() => deleteInactiveUser(inactiveUsers), MAX_CONCURRENT);
    await promisePool.start();
    console.log('User cleanup finished');
}

/* Deletes one inactive user from the list. */
function deleteInactiveUser(inactiveUsers) {
    if (inactiveUsers.length > 0) {
        const userToDelete = inactiveUsers.pop();
        // Delete the inactive user.
        const usersRef = admin.firestore().collection("users");
        return usersRef.doc(userToDelete.uid).get().then((userDoc) => {
            return userDoc.data();
        }).then((user) => {
            if (user && user.partner) {
                return user.coupleDataRef.delete().then(() => {
                    return usersRef.doc(user.partner.uid).update({
                        partner: admin.firestore.FieldValue.delete(),
                        coupleDataRef: admin.firestore.FieldValue.delete()
                    }).then(() => {
                        return usersRef.doc(userToDelete.uid).delete().then(() => {
                            return admin.auth().deleteUser(userToDelete.uid).then(() => {
                                return console.log('Deleted user account', userToDelete.uid, 'because of inactivity');
                            });
                        });
                    });
                });
            }
            return usersRef.doc(userToDelete.uid).delete().then(() => {
                return admin.auth().deleteUser(userToDelete.uid).then(() => {
                    return console.log('Deleted user account', userToDelete.uid, 'because of inactivity');
                });
            });
        }).catch((error) => {
            return console.error('Deletion of inactive user account', userToDelete.uid, 'failed:', error);
        });
    } else {
        return null;
    }
}

async function getInactiveUsers(users = [], nextPageToken) {
    const result = await admin.auth().listUsers(1000, nextPageToken);
    // Find users that have not signed in in the last 60 days.
    const inactiveUsers = result.users.filter((user) => {
        if (Date.parse(user.metadata.lastSignInTime) < (Date.now() - 60 * 24 * 60 * 60 * 1000)) {
            const premium = user.customClaims && user.customClaims.premium;
            if (premium) {
                return new Date(premium.expiry) <= Date.now();
            }
            return true;
        }
        return false;
    });

    // Concat with list of previously found inactive users if there was more than 1000 users.
    users = users.concat(inactiveUsers);

    // If there are more users to fetch we fetch them.
    if (result.pageToken) {
        return getInactiveUsers(users, result.pageToken);
    }

    return users;
}