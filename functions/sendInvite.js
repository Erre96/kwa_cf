const nodemailer = require('nodemailer');
const MyErrorCodes = require('./MyErrorCodes');

exports.handler = async function (data, context, admin, functions) {
    if (context.auth == null) {
        throw new functions.https.HttpsError('unauthenticated', MyErrorCodes.ERROR_NOT_AUTHENTICATED);
    }

    if (data == null || data.receiverEmail == null || data.senderFullName == null) {
        throw new functions.https.HttpsError('invalid-argument', 'Receiver email and sender full name is required');
    }

    const receiverEmail = data.receiverEmail;
    const senderFullName = data.senderFullName;
    const senderUid = context.auth.uid;

    try {
        const stringsSnap = await admin.firestore().collection('other').doc('strings').get();
        const strings = stringsSnap.data();

        let title = strings && strings.invitationMailTitle;
        let html = strings && strings.invitationMailHTML;
        let text = strings && strings.invitationMailText;

        if (title) {
            title = title.replace(/%NAME%/g, senderFullName);
        }

        if (html) {
            html = html.replace(/%NAME%/g, senderFullName);
            html = html.replace(/%USERID%/g, senderUid)
        }

        if (text) {
            text = text.replace(/%NAME%/g, senderFullName);
            text = text.replace(/%USERID%/g, senderUid)
            text = text.replace(/\\n/g, '\n');
        }

        const transport = nodemailer.createTransport({
            host: "mailcluster.loopia.se",
            port: 587,
            auth: {
                user: functions.config().domain.email.username,
                pass: functions.config().domain.email.password
            }
        });

        const message = {
            from: {
                name: "Kärlekstanken",
                address: functions.config().domain.email.username
            },
            to: receiverEmail,
            subject: title,
            html: html,
            text: text
        };

        transport.sendMail(message, function (err, info) {
            if (err) {
                console.error(err)
            }
        });

    } catch (e) {
        throw new functions.https.HttpsError('internal', MyErrorCodes.ERROR_INTERNAL);
    }
}